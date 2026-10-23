package online.otgolosok.walk_service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Buttons of the media notification below Android 13 (from 13 on the system draws them from the
 * media session). Every button becomes an `onMediaCommand` for Dart; «Стоп» does not stop the
 * service by itself — Dart saves the checkpoint and calls `stopSession`.
 */
class WalkActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        WalkSessionManager.core?.takeIf { !it.released }?.onNotificationAction(action)
    }

    companion object {
        const val ACTION_BACK = "online.otgolosok.walk_service.action.BACK"
        const val ACTION_PLAY_PAUSE = "online.otgolosok.walk_service.action.PLAY_PAUSE"
        const val ACTION_NEXT = "online.otgolosok.walk_service.action.NEXT"
        const val ACTION_STOP = "online.otgolosok.walk_service.action.STOP"
    }
}
