package online.otgolosok.walk_service

import android.content.pm.ServiceInfo

/**
 * Foreground rules of the walk service.
 *
 * Media3's own notification manager would (a) demote the service ~10 minutes after playback
 * pauses, (b) drop the foreground state while no media item is loaded and (c) call
 * `startForeground` with the `mediaPlayback` type only, which strips the `location` type.
 * A walk leg between two stops is often silent for longer than that, so the walk service owns
 * its notification and foreground state and ignores Media3's suggestion while a session lives.
 */
internal object ForegroundPolicy {
    const val TYPE_LOCATION = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    const val TYPE_MEDIA_PLAYBACK = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK

    /** The service tracks location only for a walk with tracking on and a granted permission. */
    fun tracksLocation(kind: SessionKind, tracking: Boolean, locationGranted: Boolean): Boolean =
        kind == SessionKind.WALK && tracking && locationGranted

    /**
     * Android 14 throws `SecurityException` for a `location` foreground service without a granted
     * location permission, so the type is requested only when tracking is possible.
     */
    fun serviceTypes(kind: SessionKind, tracking: Boolean, locationGranted: Boolean): Int =
        if (tracksLocation(kind, tracking, locationGranted)) TYPE_LOCATION or TYPE_MEDIA_PLAYBACK else TYPE_MEDIA_PLAYBACK
}
