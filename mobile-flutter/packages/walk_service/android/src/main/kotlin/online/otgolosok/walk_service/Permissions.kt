package online.otgolosok.walk_service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

internal object Permissions {
    val LOCATION = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun locationGranted(context: Context): Boolean =
        granted(context, Manifest.permission.ACCESS_FINE_LOCATION) || granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun preciseLocationGranted(context: Context): Boolean = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

    /** Below Android 13 there is no runtime permission: only the app's notification switch. */
    fun notificationsGranted(context: Context): Boolean {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            enabled && granted(context, Manifest.permission.POST_NOTIFICATIONS)
        } else {
            enabled
        }
    }

    fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}

internal object PermissionResolver {
    /**
     * Android only tells "permanently denied" indirectly: after a request was denied,
     * `shouldShowRequestPermissionRationale` returns false. Without an activity (engine running
     * with the app swiped away) the rationale is unknown ([showRationale] = null) and the result
     * remembered after the last request is used.
     */
    fun status(
        granted: Boolean,
        requestedBefore: Boolean,
        showRationale: Boolean?,
        rememberedPermanent: Boolean,
    ): PermissionStatus = when {
        granted -> PermissionStatus.GRANTED
        showRationale == true -> PermissionStatus.DENIED
        showRationale == false && requestedBefore -> PermissionStatus.PERMANENTLY_DENIED
        showRationale == null && rememberedPermanent -> PermissionStatus.PERMANENTLY_DENIED
        else -> PermissionStatus.DENIED
    }
}

/** Remembers which permissions were requested and whether the last denial was permanent. */
internal class PermissionMemory(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun requestedBefore(key: String): Boolean = prefs.getBoolean("$key.requested", false)

    fun permanent(key: String): Boolean = prefs.getBoolean("$key.permanent", false)

    fun remember(key: String, permanent: Boolean) {
        prefs.edit().putBoolean("$key.requested", true).putBoolean("$key.permanent", permanent).apply()
    }

    companion object {
        const val LOCATION = "location"
        const val NOTIFICATIONS = "notifications"
        private const val PREFS = "online.otgolosok.walk_service.permissions"
    }
}
