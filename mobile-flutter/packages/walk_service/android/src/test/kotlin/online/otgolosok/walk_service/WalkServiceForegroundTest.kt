package online.otgolosok.walk_service

import android.Manifest
import android.app.Application
import android.content.Intent
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import online.otgolosok.walk_service.notification.WalkNotifications
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WalkServiceForegroundTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val events = RecordingEvents()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var controller: ServiceController<WalkService>

    @Before
    fun setUp() {
        WalkSessionManager.events = events
    }

    @After
    fun tearDown() {
        WalkSessionManager.stop()
        WalkSessionManager.events = null
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun `stays in the foreground through a silence longer than Media3's idle timeout`() {
        val service = startSession()
        val core = WalkSessionManager.core!!

        // Media3 asks to leave the foreground: nothing plays, nothing is loaded.
        service.onUpdateNotificationAsync(core.mediaSession, false)
        ShadowLooper.idleMainLooper(15, TimeUnit.MINUTES)
        service.onUpdateNotificationAsync(core.mediaSession, false)

        val shadow = shadowOf(service)
        assertFalse(shadow.isForegroundStopped)
        assertFalse(shadow.isStoppedBySelf)
        assertEquals(WalkNotifications.MEDIA_NOTIFICATION_ID, shadow.lastForegroundNotificationId)
        assertTrue(WalkSessionManager.isActive)
        assertEquals(0, events.stopped)
    }

    @Test
    fun `swiping the task away keeps the walk running`() {
        val service = startSession()

        service.onTaskRemoved(Intent())
        shadowOf(Looper.getMainLooper()).idle()

        assertFalse(shadowOf(service).isStoppedBySelf)
        assertFalse(shadowOf(service).isForegroundStopped)
        assertTrue(WalkSessionManager.isActive)
    }

    @Test
    fun `stopSession removes the notification and stops the service`() {
        val service = startSession()

        WalkSessionManager.stop()

        val shadow = shadowOf(service)
        assertTrue(shadow.isForegroundStopped)
        assertTrue(shadow.notificationShouldRemoved)
        assertTrue(shadow.isStoppedBySelf)
        assertFalse(WalkSessionManager.isActive)
        controller.destroy()
        // Stopped by Dart: no onSessionStopped echo.
        assertEquals(0, events.stopped)
    }

    @Test
    fun `a service killed without stopSession tells Dart`() {
        startSession()

        controller.destroy()

        assertEquals(1, events.stopped)
        assertFalse(WalkSessionManager.isActive)
    }

    @Test
    fun `walk without location permission keeps running and reports permission_denied`() {
        val service = startSession()

        assertEquals(ForegroundPolicy.TYPE_MEDIA_PLAYBACK, service.foregroundServiceType)
        assertEquals(listOf(LocationStatus.PERMISSION_DENIED to "permission_missing"), events.statuses)
    }

    @Test
    fun `walk with location permission runs a location foreground service`() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        val service = startSession()

        assertEquals(
            ForegroundPolicy.TYPE_LOCATION or ForegroundPolicy.TYPE_MEDIA_PLAYBACK,
            service.foregroundServiceType,
        )
    }

    @Test
    fun `starting again after location was granted mid-walk starts tracking`() {
        val service = startSession()
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        var result: Result<Unit>? = null
        scope.launch { result = runCatching { WalkSessionManager.start(app, Fixtures.config()) } }
        shadowOf(Looper.getMainLooper()).idle()

        assertTrue("restart failed: ${result?.exceptionOrNull()}", result?.isSuccess == true)
        assertEquals(
            ForegroundPolicy.TYPE_LOCATION or ForegroundPolicy.TYPE_MEDIA_PLAYBACK,
            service.foregroundServiceType,
        )
        assertEquals(LocationStatus.PERMISSION_DENIED, events.statuses.first().first)
        assertTrue(events.statuses.last().first != LocationStatus.PERMISSION_DENIED)
    }

    @Test
    fun `listen sessions never use the location type`() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)

        val service = startSession(Fixtures.config(kind = SessionKind.LISTEN))

        assertEquals(ForegroundPolicy.TYPE_MEDIA_PLAYBACK, service.foregroundServiceType)
        assertEquals(emptyList<Pair<LocationStatus, String?>>(), events.statuses)
    }

    @Test
    fun `notification Stop goes to Dart and does not stop the service`() {
        val service = startSession()

        WalkActionReceiver().onReceive(app, Intent(WalkActionReceiver.ACTION_STOP))

        assertEquals(listOf(MediaCommand(MediaCommandKind.STOP)), events.commands)
        assertFalse(shadowOf(service).isStoppedBySelf)
    }

    /** Runs `startSession` the way Dart does and completes the service start it requested. */
    private fun startSession(config: SessionConfig = Fixtures.config()): WalkService {
        var result: Result<Unit>? = null
        scope.launch { result = runCatching { WalkSessionManager.start(app, config) } }
        val intent = shadowOf(app).nextStartedService
        assertEquals(WalkService.ACTION_START, intent.action)
        controller = Robolectric.buildService(WalkService::class.java, intent).create().startCommand(0, 1)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("start failed: ${result?.exceptionOrNull()}", result?.isSuccess == true)
        return controller.get()
    }

    private class RecordingEvents : WalkEvents {
        val statuses = mutableListOf<Pair<LocationStatus, String?>>()
        val commands = mutableListOf<MediaCommand>()
        var stopped = 0

        override fun onFix(fix: Fix) = Unit

        override fun onLocationStatus(status: LocationStatus, code: String?) {
            statuses += status to code
        }

        override fun onPlayer(state: PlayerState) = Unit

        override fun onMediaCommand(command: MediaCommand) {
            commands += command
        }

        override fun onSessionStopped() {
            stopped++
        }
    }
}
