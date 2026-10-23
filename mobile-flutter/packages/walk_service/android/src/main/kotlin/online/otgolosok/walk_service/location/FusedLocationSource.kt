package online.otgolosok.walk_service.location

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.location.LocationManagerCompat
import androidx.core.os.HandlerCompat
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import online.otgolosok.walk_service.Fix
import online.otgolosok.walk_service.LocationStatus
import online.otgolosok.walk_service.Permissions

/** Google Play services fused provider, high accuracy, one fix per second by default. */
internal class FusedLocationSource(
    private val context: Context,
    private val listener: LocationListener,
) : LocationSource {
    private val client: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private var failedAttempts = 0

    override fun start(settings: LocationSettings) {
        stop()
        failedAttempts = 0
        request(settings)
    }

    private fun request(settings: LocationSettings) {
        if (!Permissions.locationGranted(context)) {
            listener.onStatus(LocationStatus.PERMISSION_DENIED, LocationStatusCodes.PERMISSION_MISSING)
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, settings.intervalMs)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS.coerceAtMost(settings.intervalMs))
            .setMinUpdateDistanceMeters(settings.minDistanceM)
            .setWaitForAccurateLocation(false)
            .build()
        val locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (callback !== this) return
                result.locations.forEach { location -> location.toFix(FUSED)?.let(listener::onFix) }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                if (callback !== this) return
                if (availability.isLocationAvailable) {
                    listener.onStatus(LocationStatus.ACTIVE, null)
                } else {
                    val code = if (locationEnabled()) LocationStatusCodes.SIGNAL_LOST else LocationStatusCodes.LOCATION_DISABLED
                    listener.onStatus(LocationStatus.UNAVAILABLE, code)
                }
            }
        }
        callback = locationCallback
        try {
            client.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
                .addOnSuccessListener {
                    if (callback !== locationCallback) return@addOnSuccessListener
                    failedAttempts = 0
                    if (locationEnabled()) {
                        listener.onStatus(LocationStatus.ACTIVE, null)
                    } else {
                        listener.onStatus(LocationStatus.UNAVAILABLE, LocationStatusCodes.LOCATION_DISABLED)
                    }
                }
                .addOnFailureListener { error ->
                    if (callback !== locationCallback) return@addOnFailureListener
                    callback = null
                    if (error is ApiException && failedAttempts < MAX_RETRIES) {
                        // Play services may be updating or briefly unreachable: bounded backoff.
                        val delayMs = RETRY_BASE_DELAY_MS shl failedAttempts
                        failedAttempts++
                        Log.w(TAG, "Fused request failed (${error.statusCode}), retry in $delayMs ms")
                        HandlerCompat.postDelayed(handler, { request(settings) }, RETRY_TOKEN, delayMs)
                    } else {
                        reportFailure(error)
                    }
                }
        } catch (error: SecurityException) {
            callback = null
            reportFailure(error)
        }
    }

    override fun stop() {
        handler.removeCallbacksAndMessages(RETRY_TOKEN)
        val current = callback ?: return
        callback = null
        client.removeLocationUpdates(current).addOnFailureListener { error ->
            Log.w(TAG, "removeLocationUpdates failed", error)
        }
    }

    private fun reportFailure(error: Exception) {
        Log.w(TAG, "Fused location request failed", error)
        if (error is SecurityException) {
            listener.onStatus(LocationStatus.PERMISSION_DENIED, LocationStatusCodes.PERMISSION_MISSING)
        } else {
            val code = (error as? ApiException)?.let { "${LocationStatusCodes.REQUEST_FAILED}_${it.statusCode}" }
                ?: LocationStatusCodes.REQUEST_FAILED
            listener.onStatus(LocationStatus.ERROR, code)
        }
    }

    private fun locationEnabled(): Boolean {
        val manager = context.getSystemService(LocationManager::class.java) ?: return false
        return LocationManagerCompat.isLocationEnabled(manager)
    }

    private companion object {
        const val TAG = "FusedLocationSource"
        const val FUSED = "fused"
        const val MIN_UPDATE_INTERVAL_MS = 1_000L
        const val MAX_RETRIES = 3
        const val RETRY_BASE_DELAY_MS = 1_000L
        val RETRY_TOKEN = Any()
    }
}

/** Fixes without an accuracy estimate are dropped: the Dart trigger cannot judge them. */
internal fun Location.toFix(provider: String): Fix? {
    if (!hasAccuracy() || !latitude.isFinite() || !longitude.isFinite()) return null
    return Fix(
        lat = latitude,
        lon = longitude,
        accuracyM = accuracy.toDouble(),
        timestampMs = time,
        provider = provider,
    )
}
