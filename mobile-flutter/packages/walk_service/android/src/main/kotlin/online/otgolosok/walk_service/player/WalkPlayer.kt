package online.otgolosok.walk_service.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import online.otgolosok.walk_service.PlayerState
import online.otgolosok.walk_service.Track
import online.otgolosok.walk_service.UriPolicy

/**
 * Single-item ExoPlayer of the walk. Reports [PlayerState] on every change and every second
 * while playing. All methods run on the main thread.
 */
@OptIn(UnstableApi::class)
internal class WalkPlayer(
    private val context: Context,
    private val fallbackArtwork: () -> ByteArray?,
    private val onState: (PlayerState) -> Unit,
) {
    val exoPlayer: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .build(),
            /* handleAudioFocus = */ true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .setSeekBackIncrementMs(WalkForwardingPlayer.SEEK_BACK_MS)
        .build()

    var track: Track? = null
        private set

    /** Overrides the artist line (below API 36 during `approach`); null restores the subtitle. */
    private var artistOverlay: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private var lastReported: PlayerState? = null
    private val extractors = DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true)
    private val loadErrorPolicy = WalkLoadErrorPolicy()

    private val ticker = object : Runnable {
        override fun run() {
            report(force = true)
            if (exoPlayer.isPlaying) handler.postDelayed(this, TICK_MS)
        }
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(
                    Player.EVENT_PLAYBACK_STATE_CHANGED,
                    Player.EVENT_PLAY_WHEN_READY_CHANGED,
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_PLAYER_ERROR,
                    Player.EVENT_POSITION_DISCONTINUITY,
                    Player.EVENT_TIMELINE_CHANGED,
                )
            ) {
                report(force = false)
            }
            if (events.contains(Player.EVENT_IS_PLAYING_CHANGED)) {
                handler.removeCallbacks(ticker)
                if (player.isPlaying) handler.postDelayed(ticker, TICK_MS)
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.w(TAG, "Playback failed: ${error.errorCodeName}", error)
        }
    }

    init {
        exoPlayer.addListener(listener)
    }

    /** [Track.uri] must already be validated with [UriPolicy]. */
    fun play(track: Track) {
        require(track.rate > 0 && track.rate.isFinite()) { "rate" }
        this.track = track
        val item = mediaItem(track)
        val factory = if (UriPolicy.isRemote(track.uri)) AudioCache.cachedFactory(context) else AudioCache.localFactory(context)
        val source = ProgressiveMediaSource.Factory(factory, extractors)
            .setLoadErrorHandlingPolicy(loadErrorPolicy)
            .createMediaSource(item)
        exoPlayer.setMediaSource(source, track.startPositionMs.coerceAtLeast(0))
        exoPlayer.playbackParameters = PlaybackParameters(track.rate.toFloat())
        exoPlayer.playWhenReady = track.autoplay
        exoPlayer.prepare()
        report(force = true)
    }

    fun pause() {
        exoPlayer.pause()
    }

    /** Also recovers an errored item (prepare again) and replays an ended one. */
    fun resume() {
        if (track == null) return
        when (exoPlayer.playbackState) {
            Player.STATE_IDLE -> exoPlayer.prepare()
            Player.STATE_ENDED -> exoPlayer.seekTo(0)
        }
        exoPlayer.play()
    }

    fun seekTo(positionMs: Long) {
        if (track == null) return
        exoPlayer.seekTo(clampPosition(positionMs))
        report(force = true)
    }

    fun seekBy(deltaMs: Long) = seekTo(exoPlayer.currentPosition + deltaMs)

    fun setRate(rate: Double) {
        exoPlayer.playbackParameters = PlaybackParameters(rate.toFloat())
    }

    fun setArtistOverlay(overlay: String?) {
        if (overlay == artistOverlay) return
        artistOverlay = overlay
        val current = track ?: return
        if (exoPlayer.mediaItemCount == 0) return
        // Same URI: ProgressiveMediaSource updates the item in place, playback is not interrupted.
        exoPlayer.replaceMediaItem(0, mediaItem(current))
    }

    fun currentState(): PlayerState {
        val error = exoPlayer.playerError
        val duration = exoPlayer.duration
        return PlayerState(
            trackId = track?.id,
            state = PlayerStateMapper.map(exoPlayer.playbackState, exoPlayer.playWhenReady, error != null),
            positionMs = exoPlayer.currentPosition.coerceAtLeast(0),
            durationMs = if (duration == C.TIME_UNSET) 0 else duration,
            errorCode = error?.errorCodeName,
        )
    }

    fun release() {
        handler.removeCallbacks(ticker)
        exoPlayer.removeListener(listener)
        exoPlayer.release()
        track = null
    }

    private fun report(force: Boolean) {
        val state = currentState()
        if (!force && state == lastReported) return
        lastReported = state
        onState(state)
    }

    private fun clampPosition(positionMs: Long): Long {
        val duration = exoPlayer.duration
        val upper = if (duration == C.TIME_UNSET) Long.MAX_VALUE else duration
        return positionMs.coerceIn(0, upper.coerceAtLeast(0))
    }

    private fun mediaItem(track: Track): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(artistOverlay ?: track.subtitle)
            .setAlbumTitle(track.album)
        val artwork = track.artworkUri
        if (artwork != null) {
            metadata.setArtworkUri(Uri.parse(artwork))
        } else {
            fallbackArtwork()?.let { metadata.setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) }
        }
        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(track.uri)
            .setMediaMetadata(metadata.build())
            .build()
    }

    private companion object {
        const val TAG = "WalkPlayer"
        const val TICK_MS = 1_000L
    }
}
