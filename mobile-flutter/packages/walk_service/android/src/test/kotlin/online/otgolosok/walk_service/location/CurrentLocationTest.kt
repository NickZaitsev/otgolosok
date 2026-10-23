package online.otgolosok.walk_service.location

import android.Manifest
import android.app.Application
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import online.otgolosok.walk_service.LocationPriority
import online.otgolosok.walk_service.WalkErrorCodes
import online.otgolosok.walk_service.WalkServiceError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CurrentLocationTest {
    private class State(var permission: Boolean = true, var services: Boolean = true) : LocationDeviceState {
        override fun permissionGranted() = permission

        override fun servicesEnabled() = services
    }

    /** Answers with [result], throws [error], or waits until cancelled when both are null. */
    private class FakeProvider(
        override val name: String,
        private val result: Location? = null,
        private val error: Exception? = null,
    ) : CurrentLocationProvider {
        val calls = mutableListOf<Pair<LocationPriority, Long>>()

        override suspend fun current(priority: LocationPriority, maxAgeMs: Long): Location? {
            calls += priority to maxAgeMs
            error?.let { throw it }
            return result ?: awaitCancellation()
        }
    }

    private fun location(provider: String = "network", accuracy: Float? = 80f) = Location(provider).apply {
        latitude = 55.7558
        longitude = 37.6173
        time = 1_700_000_000_000
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        if (accuracy != null) this.accuracy = accuracy
    }

    private suspend fun errorOf(block: suspend () -> Unit): WalkServiceError {
        try {
            block()
        } catch (error: WalkServiceError) {
            return error
        }
        fail("expected WalkServiceError")
        throw AssertionError()
    }

    @Test
    fun `a fix from the primary provider keeps its coordinates, accuracy and provider`() = runTest {
        val primary = FakeProvider("fused", location("fused", 12f))
        val fix = CurrentLocation(State(), primary, null).current(LocationPriority.PRECISE, 0, 20_000)!!
        assertEquals(55.7558, fix.lat, 0.0)
        assertEquals(37.6173, fix.lon, 0.0)
        assertEquals(12.0, fix.accuracyM, 0.001)
        assertEquals("fused", fix.provider)
        assertEquals(listOf(LocationPriority.PRECISE to 0L), primary.calls)
    }

    @Test
    fun `no permission is permission_denied and asks no provider`() = runTest {
        val primary = FakeProvider("fused", location())
        val error = errorOf { CurrentLocation(State(permission = false), primary, null).current(LocationPriority.COARSE, 60_000, 10_000) }
        assertEquals(WalkErrorCodes.PERMISSION_DENIED, error.code)
        assertTrue(primary.calls.isEmpty())
    }

    @Test
    fun `location switched off is location_unavailable with the location_disabled detail`() = runTest {
        val primary = FakeProvider("fused", location())
        val error = errorOf { CurrentLocation(State(services = false), primary, null).current(LocationPriority.COARSE, 60_000, 10_000) }
        assertEquals(WalkErrorCodes.LOCATION_UNAVAILABLE, error.code)
        assertEquals(LocationStatusCodes.LOCATION_DISABLED, error.details)
        assertTrue(primary.calls.isEmpty())
    }

    @Test
    fun `limits outside the contract are invalid_argument`() = runTest {
        val locator = CurrentLocation(State(), FakeProvider("fused", location()), null)
        for ((maxAge, timeout) in listOf(0L to 0L, 0L to CurrentLocation.MAX_TIMEOUT_MS + 1, -1L to 1_000L)) {
            val error = errorOf { locator.current(LocationPriority.PRECISE, maxAge, timeout) }
            assertEquals("maxAge=$maxAge timeout=$timeout", WalkErrorCodes.INVALID_ARGUMENT, error.code)
        }
    }

    @Test
    fun `no fix within the timeout is null`() = runTest {
        val locator = CurrentLocation(State(), FakeProvider("fused"), null)
        val result = async { locator.current(LocationPriority.PRECISE, 0, 20_000) }
        advanceTimeBy(19_999)
        runCurrent()
        assertTrue(result.isActive)
        advanceTimeBy(2)
        runCurrent()
        assertNull(result.await())
    }

    @Test
    fun `cancelAll ends pending requests with null`() = runTest {
        val locator = CurrentLocation(State(), FakeProvider("fused"), null)
        val coarse = async(start = CoroutineStart.UNDISPATCHED) { locator.current(LocationPriority.COARSE, 60_000, 10_000) }
        val precise = async(start = CoroutineStart.UNDISPATCHED) { locator.current(LocationPriority.PRECISE, 0, 20_000) }
        locator.cancelAll()
        assertNull(coarse.await())
        assertNull(precise.await())
    }

    @Test
    fun `a failing fused provider falls back to the platform one`() = runTest {
        val fallback = FakeProvider("platform", location("network", 150f))
        val fix = CurrentLocation(State(), FakeProvider("fused", error = IllegalStateException("Play services updating")), fallback)
            .current(LocationPriority.COARSE, 60_000, 10_000)!!
        assertEquals("network", fix.provider)
        assertEquals(listOf(LocationPriority.COARSE to 60_000L), fallback.calls)
    }

    @Test
    fun `a failure without a fallback is location_unavailable with the request_failed detail`() = runTest {
        val error = errorOf {
            CurrentLocation(State(), FakeProvider("platform", error = IllegalArgumentException("no provider")), null)
                .current(LocationPriority.PRECISE, 0, 20_000)
        }
        assertEquals(WalkErrorCodes.LOCATION_UNAVAILABLE, error.code)
        assertEquals(LocationStatusCodes.REQUEST_FAILED, error.details)
    }

    @Test
    fun `a permission revoked during the request is permission_denied`() = runTest {
        val fallback = FakeProvider("platform", location())
        val error = errorOf {
            CurrentLocation(State(), FakeProvider("fused", error = SecurityException("revoked")), fallback)
                .current(LocationPriority.PRECISE, 0, 20_000)
        }
        assertEquals(WalkErrorCodes.PERMISSION_DENIED, error.code)
        assertTrue(fallback.calls.isEmpty())
    }

    @Test
    fun `a location without accuracy is no fix`() = runTest {
        val fix = CurrentLocation(State(), FakeProvider("fused", location(accuracy = null)), null).current(LocationPriority.PRECISE, 0, 20_000)
        assertNull(fix)
    }

    @Test
    fun `platform provider choice follows priority, switches and the fine permission`() {
        val gps = LocationManager.GPS_PROVIDER
        val network = LocationManager.NETWORK_PROVIDER
        data class Case(val priority: LocationPriority, val enabled: Set<String>, val fine: Boolean, val expected: String?)
        val cases = listOf(
            Case(LocationPriority.PRECISE, setOf(gps, network), fine = true, expected = gps),
            Case(LocationPriority.PRECISE, setOf(gps, network), fine = false, expected = network),
            Case(LocationPriority.PRECISE, setOf(network), fine = true, expected = network),
            Case(LocationPriority.COARSE, setOf(gps, network), fine = true, expected = network),
            Case(LocationPriority.COARSE, setOf(gps), fine = true, expected = gps),
            Case(LocationPriority.COARSE, setOf(gps), fine = false, expected = null),
            Case(LocationPriority.PRECISE, emptySet(), fine = true, expected = null),
        )
        for (case in cases) {
            assertEquals(case.toString(), case.expected, PlatformProviderChoice.choose(case.priority, case.enabled, case.fine))
        }
    }

    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val manager = app.getSystemService(LocationManager::class.java)

    private fun platformDevice(fine: Boolean) {
        val permissions = if (fine) {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        } else {
            arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        shadowOf(app).grantPermissions(*permissions)
        shadowOf(manager).setLocationEnabled(true)
        shadowOf(manager).setProviderEnabled(LocationManager.GPS_PROVIDER, true)
        shadowOf(manager).setProviderEnabled(LocationManager.NETWORK_PROVIDER, true)
    }

    @Test
    fun `platform coarse request returns a fresh cached fix at once`() = runTest {
        platformDevice(fine = true)
        shadowOf(manager).setLastKnownLocation(LocationManager.NETWORK_PROVIDER, location("network", 200f))
        shadowOf(manager).setLastKnownLocation(LocationManager.GPS_PROVIDER, location("gps", 15f))
        val location = PlatformCurrentLocation(app).current(LocationPriority.COARSE, 60_000)!!
        assertEquals("gps", location.provider)
    }

    @Test
    fun `platform precise request ignores the cache and waits for GPS`() = runTest {
        platformDevice(fine = true)
        shadowOf(manager).setLastKnownLocation(LocationManager.NETWORK_PROVIDER, location("network", 200f))
        val result = async(start = CoroutineStart.UNDISPATCHED) { PlatformCurrentLocation(app).current(LocationPriority.PRECISE, 0) }
        assertTrue(result.isActive)
        shadowOf(manager).simulateLocation(location("gps", 8f))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("gps", result.await()!!.provider)
    }

    @Test
    fun `platform request skips a cached fix older than the limit`() = runTest {
        platformDevice(fine = false)
        val stale = location("network", 200f)
        shadowOf(manager).setLastKnownLocation(LocationManager.NETWORK_PROVIDER, stale)
        shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.MINUTES)
        val result = async(start = CoroutineStart.UNDISPATCHED) { PlatformCurrentLocation(app).current(LocationPriority.COARSE, 60_000) }
        assertTrue(result.isActive)
        result.cancel()
    }
}
