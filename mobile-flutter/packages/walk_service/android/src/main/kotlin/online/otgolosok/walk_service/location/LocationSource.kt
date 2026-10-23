package online.otgolosok.walk_service.location

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import online.otgolosok.walk_service.Fix
import online.otgolosok.walk_service.LocationStatus

internal data class LocationSettings(val intervalMs: Long, val minDistanceM: Float)

/** Receives fixes and status changes on the main looper. */
internal interface LocationListener {
    fun onFix(fix: Fix)

    fun onStatus(status: LocationStatus, code: String?)
}

/** Continuous location updates for the walk service. Both methods run on the main thread. */
internal interface LocationSource {
    fun start(settings: LocationSettings)

    fun stop()
}

internal enum class LocationBackend { FUSED, PLATFORM }

internal object LocationSourceSelector {
    /**
     * Fused provider when Google Play services are usable, otherwise the platform LocationManager
     * (devices without Google services, e.g. RuStore-only phones). A failing availability check
     * counts as "not available".
     */
    fun select(playServicesAvailable: () -> Boolean): LocationBackend {
        val available = try {
            playServicesAvailable()
        } catch (error: RuntimeException) {
            Log.w(TAG, "Google Play services check failed, using the platform provider", error)
            false
        }
        return if (available) LocationBackend.FUSED else LocationBackend.PLATFORM
    }

    fun googlePlayServicesAvailable(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    fun create(
        context: Context,
        listener: LocationListener,
        playServicesAvailable: () -> Boolean = { googlePlayServicesAvailable(context) },
    ): LocationSource = when (select(playServicesAvailable)) {
        LocationBackend.FUSED -> FusedLocationSource(context, listener)
        LocationBackend.PLATFORM -> PlatformLocationSource(context, listener)
    }

    private const val TAG = "LocationSource"
}

/** Status codes sent with `onLocationStatus` (the `code` argument). */
internal object LocationStatusCodes {
    const val PERMISSION_MISSING = "permission_missing"
    const val LOCATION_DISABLED = "location_disabled"
    const val NO_PROVIDER = "no_provider"
    const val SIGNAL_LOST = "signal_lost"
    const val REQUEST_FAILED = "request_failed"
}
