package online.otgolosok.walk_service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import online.otgolosok.walk_service.location.LocationListener
import online.otgolosok.walk_service.location.LocationSettings
import online.otgolosok.walk_service.location.LocationSource
import online.otgolosok.walk_service.location.LocationSourceSelector
import online.otgolosok.walk_service.location.LocationStatusCodes
import online.otgolosok.walk_service.notification.CardText
import online.otgolosok.walk_service.notification.LiveUpdatePlanner
import online.otgolosok.walk_service.notification.MediaCardModel
import online.otgolosok.walk_service.notification.NotificationThrottle
import online.otgolosok.walk_service.notification.WalkNotifications
import online.otgolosok.walk_service.player.Prefetcher
import online.otgolosok.walk_service.player.WalkForwardingPlayer
import online.otgolosok.walk_service.player.WalkPlayer
import java.io.ByteArrayOutputStream

/** Native → Dart events; implemented by the plugin, always called on the main thread. */
internal interface WalkEvents {
    fun onFix(fix: Fix)

    fun onLocationStatus(status: LocationStatus, code: String?)

    fun onPlayer(state: PlayerState)

    fun onMediaCommand(command: MediaCommand)

    fun onSessionStopped()
}

/**
 * Everything one walk session owns: the player and its media session, the location source, the
 * card (media notification and Live Update) and the prefetcher. Created by [WalkSessionManager]
 * before the service starts (so Dart may call `play` right after `startSession`), released when
 * the session stops. Main thread only.
 */
@OptIn(UnstableApi::class)
internal class WalkSessionCore(
    private val context: Context,
    config: SessionConfig,
    private val events: WalkEvents,
    private val elapsedRealtime: () -> Long = SystemClock::elapsedRealtime,
    private val playServicesAvailable: () -> Boolean = { LocationSourceSelector.googlePlayServicesAvailable(context) },
) {
    var config: SessionConfig = config
        private set

    /** Set by [WalkService] once `startForeground` succeeded. */
    var foregroundActive = false

    var released = false
        private set

    private val notifications = WalkNotifications(context)
    private val appIconBytes: ByteArray? by lazy { loadAppIcon() }
    val player = WalkPlayer(context, { appIconBytes }, ::onPlayerState)
    private val sessionPlayer = WalkForwardingPlayer(player.exoPlayer) { command -> events.onMediaCommand(command) }
    private var contentIntent: PendingIntent? = buildContentIntent(config.contentRoute)
    val mediaSession: MediaSession = MediaSession.Builder(context, sessionPlayer)
        .setId(SESSION_ID)
        .setCallback(SessionCallback())
        .setMediaButtonPreferences(mediaButtons(config.texts))
        .apply { contentIntent?.let(::setSessionActivity) }
        .build()

    private val prefetcher = Prefetcher(context)
    private var location: LocationSource? = null
    private var lastLocationStatus: Pair<LocationStatus, String?>? = null
    private var card: CardState? = null
    private val liveThrottle = NotificationThrottle()
    private val subtitleThrottle = NotificationThrottle()
    private var liveUpdateShown = false
    private var artistOverlay: String? = null
    private var artwork: Pair<String, Bitmap?>? = null
    private var lastTrackId: String? = null
    private var lastIsPlaying = false

    init {
        notifications.ensureChannels(config.texts)
    }

    /** Foreground service types for this session (location only when it can be tracked). */
    fun foregroundTypes(): Int =
        ForegroundPolicy.serviceTypes(config.kind, config.tracking, Permissions.locationGranted(context))

    /** Called by the service right after `startForeground`. */
    fun onForegroundStarted(types: Int) {
        foregroundActive = true
        updateTracking(types)
    }

    /**
     * `startSession` while a session is active: new texts, route and tracking settings. Dart calls
     * it (from a visible screen) after the user granted location mid-walk to start tracking.
     */
    fun reconfigure(newConfig: SessionConfig, types: Int) {
        val trackingChanged = newConfig.kind != config.kind || newConfig.tracking != config.tracking ||
            newConfig.locationIntervalMs != config.locationIntervalMs || newConfig.minDistanceM != config.minDistanceM
        config = newConfig
        notifications.ensureChannels(newConfig.texts)
        contentIntent = buildContentIntent(newConfig.contentRoute)
        contentIntent?.let(mediaSession::setSessionActivity)
        mediaSession.setMediaButtonPreferences(mediaButtons(newConfig.texts))
        if (trackingChanged) {
            location?.stop()
            location = null
            lastLocationStatus = null
        }
        // Also starts tracking when location was granted after the walk started without it.
        updateTracking(types)
        card?.let { applyCard(it, force = true) }
        refreshCard()
    }

    fun play(track: Track) {
        player.play(track)
        refreshCard()
    }

    fun prefetch(uri: String) = prefetcher.prefetch(uri)

    fun updateCard(state: CardState) {
        card = state
        applyCard(state, force = false)
    }

    /** Buttons of the media notification below Android 13 ([WalkActionReceiver]). */
    fun onNotificationAction(action: String) {
        val command = when (action) {
            WalkActionReceiver.ACTION_BACK -> MediaCommand(MediaCommandKind.SEEK_BY, -WalkForwardingPlayer.SEEK_BACK_MS)
            WalkActionReceiver.ACTION_PLAY_PAUSE ->
                MediaCommand(if (player.exoPlayer.playWhenReady) MediaCommandKind.PAUSE else MediaCommandKind.PLAY)
            WalkActionReceiver.ACTION_NEXT -> MediaCommand(MediaCommandKind.NEXT)
            WalkActionReceiver.ACTION_STOP -> MediaCommand(MediaCommandKind.STOP)
            else -> return
        }
        events.onMediaCommand(command)
    }

    fun buildNotification(): Notification =
        notifications.buildMedia(mediaSession, mediaCardModel(), config.texts, contentIntent)

    /** Re-posts the foreground notification; never leaves the foreground. */
    fun refreshCard() {
        if (!foregroundActive || released) return
        notifications.notifyMedia(buildNotification())
    }

    fun release() {
        if (released) return
        released = true
        foregroundActive = false
        location?.stop()
        location = null
        prefetcher.close()
        notifications.cancelLiveUpdate()
        mediaSession.release()
        player.release()
    }

    private fun updateTracking(types: Int) {
        if (location != null) return
        if (types and ForegroundPolicy.TYPE_LOCATION == 0) {
            if (config.kind == SessionKind.WALK && config.tracking) {
                reportLocationStatus(LocationStatus.PERMISSION_DENIED, LocationStatusCodes.PERMISSION_MISSING)
            }
            return
        }
        val source = LocationSourceSelector.create(context, locationListener, playServicesAvailable)
        location = source
        source.start(LocationSettings(config.locationIntervalMs, config.minDistanceM.toFloat()))
    }

    private val locationListener = object : LocationListener {
        override fun onFix(fix: Fix) {
            if (!released) events.onFix(fix)
        }

        override fun onStatus(status: LocationStatus, code: String?) {
            if (!released) reportLocationStatus(status, code)
        }
    }

    private fun reportLocationStatus(status: LocationStatus, code: String?) {
        val next = status to code
        if (next == lastLocationStatus) return
        lastLocationStatus = next
        events.onLocationStatus(status, code)
    }

    private fun applyCard(state: CardState, force: Boolean) {
        val texts = config.texts
        val now = elapsedRealtime()
        val live = LiveUpdatePlanner.content(Build.VERSION.SDK_INT, notifications.canPostPromoted(), state, texts)
        if (live == null) {
            if (liveUpdateShown) notifications.cancelLiveUpdate()
            liveUpdateShown = false
            liveThrottle.reset()
        } else {
            val key = live.copy(chip = null, roundedDistanceM = null)
            if (force) liveThrottle.reset()
            if (liveThrottle.shouldPost(key, live.roundedDistanceM, now)) {
                notifications.postLiveUpdate(notifications.buildLiveUpdate(live, contentIntent))
                liveUpdateShown = true
            }
        }
        // Without a Live Update (below API 36, or promotion not allowed) the distance goes into
        // the media notification subtitle during `approach`.
        val overlay = if (live == null) CardText.approachSubtitle(texts, state) else null
        if (overlay == null) {
            subtitleThrottle.reset()
            setArtistOverlay(null)
        } else {
            if (force) subtitleThrottle.reset()
            val key = CardText.toStop(texts, state) to state.chapterIndex
            if (subtitleThrottle.shouldPost(key, CardText.roundedDistance(state.distanceM), now)) setArtistOverlay(overlay)
        }
    }

    private fun setArtistOverlay(overlay: String?) {
        if (overlay == artistOverlay) return
        artistOverlay = overlay
        player.setArtistOverlay(overlay)
        refreshCard()
    }

    private fun onPlayerState(state: PlayerState) {
        if (released) return
        events.onPlayer(state)
        val trackId = player.track?.id
        val isPlaying = state.state == PlaybackState.PLAYING || state.state == PlaybackState.BUFFERING
        if (trackId != lastTrackId || isPlaying != lastIsPlaying) {
            lastTrackId = trackId
            lastIsPlaying = isPlaying
            if (trackId != null && artwork?.first != trackId) loadArtwork(trackId)
            refreshCard()
        }
    }

    private fun mediaCardModel(): MediaCardModel {
        val track = player.track
        return MediaCardModel(
            title = track?.title ?: config.walkTitle,
            text = artistOverlay ?: track?.subtitle,
            subText = track?.album ?: config.walkTitle,
            isPlaying = lastIsPlaying,
            largeIcon = artwork?.takeIf { it.first == track?.id }?.second,
        )
    }

    private fun loadArtwork(trackId: String) {
        artwork = trackId to null
        val future = try {
            mediaSession.bitmapLoader.loadBitmapFromMetadata(player.exoPlayer.mediaMetadata)
        } catch (error: RuntimeException) {
            Log.w(TAG, "Artwork request failed", error)
            null
        } ?: return
        Futures.addCallback(
            future,
            object : FutureCallback<Bitmap> {
                override fun onSuccess(result: Bitmap) {
                    if (released || artwork?.first != trackId) return
                    artwork = trackId to result
                    refreshCard()
                }

                override fun onFailure(error: Throwable) {
                    // The card stays without a picture; the session keeps the metadata artwork.
                    Log.w(TAG, "Artwork was not loaded: ${error.javaClass.simpleName}")
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    private fun buildContentIntent(route: String): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch == null) {
            Log.w(TAG, "No launch activity: the walk card will not open the app")
            return null
        }
        launch.putExtra(WalkServicePlugin.EXTRA_ROUTE, route)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            CONTENT_REQUEST_CODE,
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun loadAppIcon(): ByteArray? = try {
        val bitmap = context.packageManager.getApplicationIcon(context.packageName).toBitmap(ICON_SIZE_PX, ICON_SIZE_PX)
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    } catch (error: Exception) {
        Log.w(TAG, "App icon is not available as artwork", error)
        null
    }

    private inner class SessionCallback : MediaSession.Callback {
        /** «Стоп» is offered to trusted controllers (system UI, this app); others keep the defaults. */
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val builder = MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
            if (controller.isTrusted) {
                builder.setAvailableSessionCommands(
                    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(STOP_COMMAND).build(),
                )
            }
            return builder.build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction != STOP_ACTION) {
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            events.onMediaCommand(MediaCommand(MediaCommandKind.STOP))
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        /** A walk cannot be resumed by the system after it ended: Dart restores checkpoints. */
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> =
            Futures.immediateFailedFuture(UnsupportedOperationException("Прогулка не восстанавливается системой."))
    }

    companion object {
        private const val TAG = "WalkSession"
        private const val SESSION_ID = "otgolosok_walk"
        private const val STOP_ACTION = "online.otgolosok.walk_service.STOP"
        private const val CONTENT_REQUEST_CODE = 0x4F54
        private const val ICON_SIZE_PX = 256
        private val STOP_COMMAND = SessionCommand(STOP_ACTION, Bundle.EMPTY)

        fun mediaButtons(texts: NotificationTexts): List<CommandButton> = listOf(
            CommandButton.Builder(CommandButton.ICON_SKIP_BACK_15)
                .setPlayerCommand(Player.COMMAND_SEEK_BACK)
                .setDisplayName(texts.backAction)
                .setSlots(CommandButton.SLOT_BACK)
                .build(),
            CommandButton.Builder(CommandButton.ICON_NEXT)
                .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT)
                .setDisplayName(texts.nextAction)
                .setSlots(CommandButton.SLOT_FORWARD)
                .build(),
            CommandButton.Builder(CommandButton.ICON_STOP)
                .setSessionCommand(STOP_COMMAND)
                .setDisplayName(texts.stopAction)
                .setSlots(CommandButton.SLOT_OVERFLOW)
                .build(),
        )
    }
}
