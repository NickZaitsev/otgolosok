package online.otgolosok.walk_service.notification

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaStyleNotificationHelper
import online.otgolosok.walk_service.NotificationTexts
import online.otgolosok.walk_service.R
import online.otgolosok.walk_service.WalkActionReceiver

/** What the media card shows; built by the session from the track, the card and the texts. */
internal data class MediaCardModel(
    val title: String,
    val text: String?,
    val subText: String?,
    val isPlaying: Boolean,
    val largeIcon: Bitmap?,
)

/**
 * Notifications of the walk: the media card (the foreground notification, MediaStyle bound to
 * the Media3 session) and, on Android 16+, the promoted Live Update on its own channel.
 * MediaStyle cannot be promoted, so these are two notifications.
 */
internal class WalkNotifications(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    fun ensureChannels(texts: NotificationTexts) {
        try {
            manager.createNotificationChannel(
                NotificationChannelCompat.Builder(MEDIA_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
                    .setName(texts.channelName)
                    .setShowBadge(false)
                    .build(),
            )
            if (Build.VERSION.SDK_INT >= LiveUpdatePlanner.MIN_SDK) {
                // Default importance: Live Updates are not shown for IMPORTANCE_MIN/LOW channels.
                manager.createNotificationChannel(
                    NotificationChannelCompat.Builder(LIVE_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                        .setName(texts.liveChannelName)
                        .setSound(null, null)
                        .setVibrationEnabled(false)
                        .setShowBadge(false)
                        .build(),
                )
            }
        } catch (error: RuntimeException) {
            // The walk must not fail because of a channel; the card may then stay hidden.
            Log.w(TAG, "Notification channels were not created", error)
        }
    }

    @OptIn(UnstableApi::class)
    fun buildMedia(session: MediaSession, model: MediaCardModel, texts: NotificationTexts, contentIntent: PendingIntent?): Notification {
        val playPause = if (model.isPlaying) {
            action(CommandButton.ICON_PAUSE, context.getString(MEDIA3_PAUSE), WalkActionReceiver.ACTION_PLAY_PAUSE)
        } else {
            action(CommandButton.ICON_PLAY, context.getString(MEDIA3_PLAY), WalkActionReceiver.ACTION_PLAY_PAUSE)
        }
        // Below Android 13 these actions are the lock-screen buttons; from 13 on the system draws
        // the controls from the session (media button preferences in WalkMediaSession).
        return NotificationCompat.Builder(context, MEDIA_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_otgolosok)
            .setContentTitle(model.title)
            .setContentText(model.text)
            .setSubText(model.subText)
            .setLargeIcon(model.largeIcon)
            .setContentIntent(contentIntent)
            .addAction(action(CommandButton.ICON_SKIP_BACK_15, texts.backAction, WalkActionReceiver.ACTION_BACK))
            .addAction(playPause)
            .addAction(action(CommandButton.ICON_NEXT, texts.nextAction, WalkActionReceiver.ACTION_NEXT))
            .addAction(action(CommandButton.ICON_STOP, texts.stopAction, WalkActionReceiver.ACTION_STOP))
            .setStyle(MediaStyleNotificationHelper.MediaStyle(session).setShowActionsInCompactView(0, 1, 2))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    /** Updates the foreground notification in place (same id as `startForeground`). */
    @SuppressLint("MissingPermission")
    fun notifyMedia(notification: Notification) {
        try {
            manager.notify(MEDIA_NOTIFICATION_ID, notification)
        } catch (error: SecurityException) {
            // POST_NOTIFICATIONS denied: the service stays in the foreground without a visible card.
            Log.w(TAG, "Media notification was not updated", error)
        }
    }

    /** True when the user and the system allow a promoted Live Update right now. */
    fun canPostPromoted(): Boolean {
        if (Build.VERSION.SDK_INT < LiveUpdatePlanner.MIN_SDK || !manager.areNotificationsEnabled()) return false
        val platform = context.getSystemService(NotificationManager::class.java) ?: return false
        return try {
            platform.canPostPromotedNotifications()
        } catch (error: RuntimeException) {
            Log.w(TAG, "canPostPromotedNotifications failed", error)
            false
        }
    }

    fun buildLiveUpdate(content: LiveUpdateContent, contentIntent: PendingIntent?): Notification {
        val style = NotificationCompat.ProgressStyle()
            .setProgressSegments(List(content.segmentCount) { NotificationCompat.ProgressStyle.Segment(1) })
            .setProgress(content.progress)
        val builder = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_otgolosok)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setContentIntent(contentIntent)
            .setStyle(style)
            .setOngoing(true)
            .setRequestPromotedOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
        content.chip?.let { builder.setShortCriticalText(it) }
        return builder.build()
    }

    @SuppressLint("MissingPermission")
    fun postLiveUpdate(notification: Notification) {
        try {
            manager.notify(LIVE_NOTIFICATION_ID, notification)
        } catch (error: SecurityException) {
            Log.w(TAG, "Live Update was not posted", error)
        }
    }

    fun cancelLiveUpdate() {
        manager.cancel(LIVE_NOTIFICATION_ID)
    }

    @OptIn(UnstableApi::class)
    private fun action(icon: Int, title: String, action: String): NotificationCompat.Action {
        val intent = Intent(context, WalkActionReceiver::class.java).setAction(action).setPackage(context.packageName)
        val pending = PendingIntent.getBroadcast(
            context,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Action(CommandButton.getIconResIdForIconConstant(icon), title, pending)
    }

    companion object {
        private const val TAG = "WalkNotifications"
        const val MEDIA_CHANNEL_ID = "otgolosok_walk"
        const val LIVE_CHANNEL_ID = "otgolosok_walk_live"
        const val MEDIA_NOTIFICATION_ID = 0x4F54_0001
        const val LIVE_NOTIFICATION_ID = 0x4F54_0002

        // The contract has no play/pause texts; Media3 ships them localized (ru, en, zh, …).
        private val MEDIA3_PLAY = androidx.media3.session.R.string.media3_controls_play_description
        private val MEDIA3_PAUSE = androidx.media3.session.R.string.media3_controls_pause_description
    }
}
