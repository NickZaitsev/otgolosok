package online.otgolosok.walk_service.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.CancellationSignal
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import online.otgolosok.walk_service.Fix
import online.otgolosok.walk_service.LocationPriority
import online.otgolosok.walk_service.Permissions
import online.otgolosok.walk_service.WalkErrors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One location request; cancelled through coroutine cancellation. */
internal interface CurrentLocationProvider {
    /** Provider name reported in [Fix.provider] when the location has none of its own. */
    val name: String

    /** A location, or null when the provider gave none. May throw (SecurityException, ApiException). */
    suspend fun current(priority: LocationPriority, maxAgeMs: Long): Location?
}

/** Reads the device state the one-shot request depends on; replaced in tests. */
internal interface LocationDeviceState {
    fun permissionGranted(): Boolean

    fun servicesEnabled(): Boolean
}

internal class AndroidLocationDeviceState(private val context: Context) : LocationDeviceState {
    override fun permissionGranted(): Boolean = Permissions.locationGranted(context)

    override fun servicesEnabled(): Boolean = locationServicesEnabled(context)
}

internal fun locationServicesEnabled(context: Context): Boolean {
    val manager = context.getSystemService(LocationManager::class.java) ?: return false
    return LocationManagerCompat.isLocationEnabled(manager)
}

/**
 * One fix for a visible screen (the «Моё местоположение» button), without the walk service: the app
 * is in the foreground, so no foreground service is needed. Runs on the main thread.
 *
 * The [primary] provider is the fused one when Google Play services are usable; if it fails (Play
 * services updating or unreachable), the [fallback] platform provider gets the remaining time.
 */
internal class CurrentLocation(
    private val state: LocationDeviceState,
    private val primary: CurrentLocationProvider,
    private val fallback: CurrentLocationProvider?,
) {
    private val pending = mutableSetOf<Job>()

    /** Null when no fix arrived within [timeoutMs] or [cancelAll] ended the request. */
    suspend fun current(priority: LocationPriority, maxAgeMs: Long, timeoutMs: Long): Fix? {
        if (timeoutMs !in 1..MAX_TIMEOUT_MS) throw WalkErrors.invalidArgument("timeoutMs должен быть от 1 до $MAX_TIMEOUT_MS.")
        if (maxAgeMs < 0) throw WalkErrors.invalidArgument("maxAgeMs не может быть отрицательным.")
        if (!state.permissionGranted()) throw WalkErrors.permissionDenied()
        if (!state.servicesEnabled()) throw WalkErrors.locationDisabled()
        return coroutineScope {
            val work = async { withTimeoutOrNull(timeoutMs) { resolve(priority, maxAgeMs) } }
            pending += work
            try {
                work.await()
            } catch (error: CancellationException) {
                // Our own cancelAll ends the request with null; the caller's cancellation propagates.
                if (work.isCancelled && isActive) null else throw error
            } finally {
                pending -= work
            }
        }
    }

    fun cancelAll() {
        pending.toList().forEach { it.cancel() }
    }

    private suspend fun resolve(priority: LocationPriority, maxAgeMs: Long): Fix? {
        val (location, provider) = try {
            primary.current(priority, maxAgeMs) to primary
        } catch (error: CancellationException) {
            throw error
        } catch (error: SecurityException) {
            throw WalkErrors.permissionDenied()
        } catch (error: Exception) {
            val backup = fallback ?: throw WalkErrors.locationRequestFailed(error)
            Log.w(TAG, "${primary.name} request failed, using ${backup.name}", error)
            try {
                backup.current(priority, maxAgeMs) to backup
            } catch (error: CancellationException) {
                throw error
            } catch (error: SecurityException) {
                throw WalkErrors.permissionDenied()
            } catch (error: Exception) {
                throw WalkErrors.locationRequestFailed(error)
            }
        }
        return location?.toFix(location.provider?.takeIf { it.isNotEmpty() } ?: provider.name)
    }

    companion object {
        private const val TAG = "CurrentLocation"
        const val MAX_TIMEOUT_MS = 60_000L

        fun create(context: Context): CurrentLocation {
            val platform = PlatformCurrentLocation(context)
            val playServices = LocationSourceSelector.select { LocationSourceSelector.googlePlayServicesAvailable(context) }
            return if (playServices == LocationBackend.FUSED) {
                CurrentLocation(AndroidLocationDeviceState(context), FusedCurrentLocation(context), platform)
            } else {
                CurrentLocation(AndroidLocationDeviceState(context), platform, null)
            }
        }
    }
}

/** Google Play services: `getCurrentLocation`, high accuracy for [LocationPriority.PRECISE]. */
internal class FusedCurrentLocation(context: Context) : CurrentLocationProvider {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    override val name = "fused"

    @SuppressLint("MissingPermission") // CurrentLocation checks it; a revoked permission throws SecurityException.
    override suspend fun current(priority: LocationPriority, maxAgeMs: Long): Location? {
        val request = CurrentLocationRequest.Builder()
            .setPriority(
                when (priority) {
                    LocationPriority.PRECISE -> Priority.PRIORITY_HIGH_ACCURACY
                    LocationPriority.COARSE -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
                },
            )
            .setMaxUpdateAgeMillis(maxAgeMs)
            .setGranularity(Granularity.GRANULARITY_PERMISSION_LEVEL)
            .build()
        val cancellation = CancellationTokenSource()
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancellation.cancel() }
            client.getCurrentLocation(request, cancellation.token)
                .addOnSuccessListener { location -> if (continuation.isActive) continuation.resume(location) }
                .addOnFailureListener { error -> if (continuation.isActive) continuation.resumeWithException(error) }
                .addOnCanceledListener { if (continuation.isActive) continuation.resume(null) }
        }
    }
}

/**
 * LocationManager for devices without Google Play services: a fresh cached fix if allowed, else
 * `getCurrentLocation` (API 30+; a single update below it, through LocationManagerCompat).
 */
internal class PlatformCurrentLocation(private val context: Context) : CurrentLocationProvider {
    private val manager: LocationManager? = context.getSystemService(LocationManager::class.java)
    override val name = "platform"

    @SuppressLint("MissingPermission") // CurrentLocation checks it; a revoked permission throws SecurityException.
    override suspend fun current(priority: LocationPriority, maxAgeMs: Long): Location? {
        val locationManager = manager ?: return null
        val fine = Permissions.preciseLocationGranted(context)
        val enabled = locationManager.allProviders.filter { it in PlatformProviderChoice.KNOWN && locationManager.isProviderEnabled(it) }.toSet()
        val usable = enabled.filter { it != LocationManager.GPS_PROVIDER || fine }
        if (maxAgeMs > 0) {
            val now = SystemClock.elapsedRealtimeNanos()
            usable.mapNotNull { locationManager.getLastKnownLocation(it) }
                .filter { (now - it.elapsedRealtimeNanos) / NANOS_PER_MS <= maxAgeMs }
                .minByOrNull { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE }
                ?.let { return it }
        }
        val provider = PlatformProviderChoice.choose(priority, enabled, fine) ?: return null
        return suspendCancellableCoroutine { continuation ->
            val signal = CancellationSignal()
            continuation.invokeOnCancellation { signal.cancel() }
            LocationManagerCompat.getCurrentLocation(locationManager, provider, signal, ContextCompat.getMainExecutor(context)) { location ->
                if (continuation.isActive) continuation.resume(location)
            }
        }
    }

    private companion object {
        const val NANOS_PER_MS = 1_000_000L
    }
}

internal object PlatformProviderChoice {
    val KNOWN = setOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)

    /**
     * Precise: GPS when it is on and the fine permission is granted, else the network. Coarse: the
     * network (seconds instead of a GPS cold start), else GPS. Null when nothing usable is on.
     */
    fun choose(priority: LocationPriority, enabled: Set<String>, fineGranted: Boolean): String? {
        val gps = LocationManager.GPS_PROVIDER.takeIf { fineGranted && it in enabled }
        val network = LocationManager.NETWORK_PROVIDER.takeIf { it in enabled }
        return when (priority) {
            LocationPriority.PRECISE -> gps ?: network
            LocationPriority.COARSE -> network ?: gps
        }
    }
}
