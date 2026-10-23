package online.otgolosok.walk_service.location

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import online.otgolosok.walk_service.LocationStatus
import online.otgolosok.walk_service.Permissions
import android.location.LocationListener as PlatformListener

/**
 * Fallback for devices without Google Play services: LocationManager GPS and network providers.
 * Network fixes are dropped while GPS delivers (see [PlatformFixFilter]).
 */
internal class PlatformLocationSource(
    private val context: Context,
    private val listener: LocationListener,
) : LocationSource {
    private val manager: LocationManager? = context.getSystemService(LocationManager::class.java)
    private val registered = mutableListOf<ProviderListener>()
    private var lastGpsFixElapsedMs: Long? = null

    override fun start(settings: LocationSettings) {
        stop()
        val locationManager = manager
        if (locationManager == null) {
            listener.onStatus(LocationStatus.UNAVAILABLE, LocationStatusCodes.NO_PROVIDER)
            return
        }
        if (!Permissions.locationGranted(context)) {
            listener.onStatus(LocationStatus.PERMISSION_DENIED, LocationStatusCodes.PERMISSION_MISSING)
            return
        }
        val available = locationManager.allProviders.toSet()
        val providers = PROVIDERS.filter { it in available }
        if (providers.isEmpty()) {
            listener.onStatus(LocationStatus.UNAVAILABLE, LocationStatusCodes.NO_PROVIDER)
            return
        }
        try {
            for (provider in providers) {
                val providerListener = ProviderListener(provider)
                locationManager.requestLocationUpdates(
                    provider,
                    settings.intervalMs,
                    settings.minDistanceM,
                    providerListener,
                    Looper.getMainLooper(),
                )
                registered += providerListener
            }
        } catch (error: SecurityException) {
            Log.w(TAG, "Platform location request denied", error)
            stop()
            listener.onStatus(LocationStatus.PERMISSION_DENIED, LocationStatusCodes.PERMISSION_MISSING)
            return
        } catch (error: IllegalArgumentException) {
            Log.w(TAG, "Platform location request failed", error)
            stop()
            listener.onStatus(LocationStatus.ERROR, LocationStatusCodes.REQUEST_FAILED)
            return
        }
        reportEnabledState()
    }

    override fun stop() {
        val locationManager = manager ?: return
        registered.forEach { locationManager.removeUpdates(it) }
        registered.clear()
        lastGpsFixElapsedMs = null
    }

    private fun reportEnabledState() {
        val locationManager = manager ?: return
        val anyEnabled = registered.any { locationManager.isProviderEnabled(it.provider) }
        if (anyEnabled) {
            listener.onStatus(LocationStatus.ACTIVE, null)
        } else {
            listener.onStatus(LocationStatus.UNAVAILABLE, LocationStatusCodes.LOCATION_DISABLED)
        }
    }

    private inner class ProviderListener(val provider: String) : PlatformListener {
        override fun onLocationChanged(location: Location) {
            if (this !in registered) return
            val nowMs = SystemClock.elapsedRealtime()
            if (provider == LocationManager.GPS_PROVIDER) lastGpsFixElapsedMs = nowMs
            if (!PlatformFixFilter.accept(provider, nowMs, lastGpsFixElapsedMs)) return
            location.toFix(provider)?.let(listener::onFix)
        }

        override fun onProviderEnabled(provider: String) {
            if (this in registered) reportEnabledState()
        }

        override fun onProviderDisabled(provider: String) {
            if (this in registered) reportEnabledState()
        }

        @Deprecated("Deprecated in API 29; required below it")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    private companion object {
        const val TAG = "PlatformLocationSource"
        val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
    }
}

internal object PlatformFixFilter {
    /** A network fix is a coarse fallback; it would only add jitter while GPS is fresh. */
    const val GPS_FRESH_MS = 10_000L

    fun accept(provider: String, nowElapsedMs: Long, lastGpsFixElapsedMs: Long?): Boolean {
        if (provider == LocationManager.GPS_PROVIDER) return true
        return lastGpsFixElapsedMs == null || nowElapsedMs - lastGpsFixElapsedMs > GPS_FRESH_MS
    }
}
