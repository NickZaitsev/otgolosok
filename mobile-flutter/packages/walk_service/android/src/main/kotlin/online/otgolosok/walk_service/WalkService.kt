package online.otgolosok.walk_service

import android.content.Intent
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import online.otgolosok.walk_service.notification.WalkNotifications

/**
 * Foreground service of a walk: keeps the process, location updates and playback alive with the
 * screen off and after the task is swiped away. Started only by [WalkSessionManager.start] and
 * stopped only by [WalkSessionManager.stop] (or by the system).
 *
 * Foreground handling deliberately bypasses Media3's notification manager: see
 * [onUpdateNotificationAsync] and [ForegroundPolicy].
 */
@OptIn(UnstableApi::class)
class WalkService : MediaSessionService() {
    private var foregroundTypes = 0

    override fun onCreate() {
        super.onCreate()
        WalkSessionManager.onServiceCreated(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Media3 handles media button intents here.
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_START) enterForeground()
        // After a system kill the walk is resumed by the user from the Dart checkpoint.
        return START_NOT_STICKY
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        WalkSessionManager.core?.takeIf { !it.released }?.mediaSession

    /**
     * Media3 calls this whenever it thinks the notification or the foreground state should change,
     * suggesting `startInForegroundRequired = false` ~10 minutes after playback pauses and while no
     * item is loaded. The walk ignores the suggestion: it only refreshes its own notification and
     * stays in the foreground until [stopWalk]. Not calling super also keeps Media3 from calling
     * `startForeground` with the `mediaPlayback` type alone, which would drop `location`.
     */
    override fun onUpdateNotificationAsync(session: MediaSession, startInForegroundRequired: Boolean): ListenableFuture<Void?> {
        WalkSessionManager.core?.takeIf { it.mediaSession === session }?.refreshCard()
        return Futures.immediateVoidFuture()
    }

    /** Swiping the app away from Recents must not end the walk (decision 10). */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (WalkSessionManager.core != null) return
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        WalkSessionManager.onServiceDestroyed(this)
        super.onDestroy()
    }

    /** Re-applies foreground types (a running `listen` session became a `walk`). */
    internal fun updateForeground(types: Int): Int {
        val core = WalkSessionManager.core ?: return foregroundTypes
        if (types == foregroundTypes) return types
        return try {
            ServiceCompat.startForeground(this, WalkNotifications.MEDIA_NOTIFICATION_ID, core.buildNotification(), types)
            foregroundTypes = types
            types
        } catch (error: RuntimeException) {
            Log.w(TAG, "Foreground types were not changed", error)
            foregroundTypes
        }
    }

    internal fun stopWalk(core: WalkSessionCore) {
        if (isSessionAdded(core.mediaSession)) removeSession(core.mediaSession)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        foregroundTypes = 0
        stopSelf()
    }

    private fun enterForeground() {
        val core = WalkSessionManager.core
        if (core == null || core.released) {
            // A late start intent (the start timed out or was stopped meanwhile).
            stopWithoutSession()
            return
        }
        val types = core.foregroundTypes()
        try {
            ServiceCompat.startForeground(this, WalkNotifications.MEDIA_NOTIFICATION_ID, core.buildNotification(), types)
        } catch (error: RuntimeException) {
            // ForegroundServiceStartNotAllowedException (app not visible) or SecurityException
            // (Android 14 location rules).
            Log.w(TAG, "startForeground refused", error)
            stopWithoutSession()
            WalkSessionManager.onServiceStartFailed(this, error)
            return
        }
        foregroundTypes = types
        if (!isSessionAdded(core.mediaSession)) addSession(core.mediaSession)
        core.onForegroundStarted(types)
        WalkSessionManager.onServiceStarted(this)
        core.refreshCard()
    }

    /**
     * `startForegroundService` obliges the service to call `startForeground`, even when it is
     * about to stop; otherwise the system crashes the app. A minimal media notification is used
     * and removed at once.
     */
    private fun stopWithoutSession() {
        try {
            val channelId = WalkNotifications.MEDIA_CHANNEL_ID
            val manager = NotificationManagerCompat.from(this)
            if (manager.getNotificationChannelCompat(channelId) == null) {
                manager.createNotificationChannel(
                    NotificationChannelCompat.Builder(channelId, NotificationManagerCompat.IMPORTANCE_LOW)
                        .setName(applicationInfo.loadLabel(packageManager))
                        .build(),
                )
            }
            val notification = NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.drawable.ic_stat_otgolosok)
                .setSilent(true)
                .build()
            ServiceCompat.startForeground(
                this,
                WalkNotifications.MEDIA_NOTIFICATION_ID,
                notification,
                ForegroundPolicy.TYPE_MEDIA_PLAYBACK,
            )
        } catch (error: RuntimeException) {
            Log.w(TAG, "Shutdown foreground notification refused", error)
        } finally {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            foregroundTypes = 0
            stopSelf()
        }
    }

    companion object {
        private const val TAG = "WalkService"
        internal const val ACTION_START = "online.otgolosok.walk_service.action.START"
    }
}
