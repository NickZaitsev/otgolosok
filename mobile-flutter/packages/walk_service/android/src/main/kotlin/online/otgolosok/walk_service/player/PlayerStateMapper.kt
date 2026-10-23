package online.otgolosok.walk_service.player

import androidx.media3.common.Player
import online.otgolosok.walk_service.PlaybackState

internal object PlayerStateMapper {
    /**
     * Maps ExoPlayer state to the contract. `READY` with `playWhenReady` is reported as `playing`
     * even while playback is suppressed (a phone call took audio focus): playback resumes by
     * itself, and the walk must keep treating the story as busy so no new story interrupts it.
     */
    fun map(playbackState: Int, playWhenReady: Boolean, hasError: Boolean): PlaybackState = when {
        hasError -> PlaybackState.ERROR
        playbackState == Player.STATE_IDLE -> PlaybackState.IDLE
        playbackState == Player.STATE_ENDED -> PlaybackState.ENDED
        playbackState == Player.STATE_BUFFERING -> if (playWhenReady) PlaybackState.BUFFERING else PlaybackState.PAUSED
        playWhenReady -> PlaybackState.PLAYING
        else -> PlaybackState.PAUSED
    }
}
