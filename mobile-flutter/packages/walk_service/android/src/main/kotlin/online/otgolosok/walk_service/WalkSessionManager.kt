package online.otgolosok.walk_service

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * Process-wide owner of the walk session. The plugin (Dart side) and [WalkService] (foreground
 * side) live in the same process and meet here. Main thread only.
 */
internal object WalkSessionManager {
    private const val TAG = "WalkSessionManager"

    /** Android gives 5 s between `startForegroundService` and `startForeground`. */
    private const val START_TIMEOUT_MS = 4_500L

    var core: WalkSessionCore? = null
        private set

    private var service: WalkService? = null
    private var pendingStart: CompletableDeferred<Unit>? = null

    /** The attached plugin; events are dropped while no engine is attached. */
    var events: WalkEvents? = null

    private val dispatcher = object : WalkEvents {
        override fun onFix(fix: Fix) {
            events?.onFix(fix)
        }

        override fun onLocationStatus(status: LocationStatus, code: String?) {
            events?.onLocationStatus(status, code)
        }

        override fun onPlayer(state: PlayerState) {
            events?.onPlayer(state)
        }

        override fun onMediaCommand(command: MediaCommand) {
            events?.onMediaCommand(command)
        }

        override fun onSessionStopped() {
            events?.onSessionStopped()
        }
    }

    val isActive: Boolean get() = core?.foregroundActive == true

    /** The running session, or `invalid_argument` for player/card calls without one. */
    fun requireActive(): WalkSessionCore = core?.takeIf { !it.released } ?: throw WalkErrors.noActiveSession()

    /**
     * Starts the foreground service and waits until it is in the foreground. Must be called while
     * an activity of the app is visible (a tap): Android 12+ refuses background starts and
     * Android 14+ refuses a `location` service started from the background.
     */
    suspend fun start(context: Context, config: SessionConfig) {
        val existing = core
        if (existing != null) {
            if (!existing.foregroundActive) throw WalkErrors.invalidArgument("Прогулка уже запускается.")
            val types = service?.updateForeground(existing.foregroundTypes()) ?: existing.foregroundTypes()
            existing.reconfigure(config, types)
            return
        }
        val appContext = context.applicationContext
        val newCore = WalkSessionCore(appContext, config, dispatcher)
        val waiter = CompletableDeferred<Unit>()
        core = newCore
        pendingStart = waiter
        try {
            ContextCompat.startForegroundService(appContext, Intent(appContext, WalkService::class.java).setAction(WalkService.ACTION_START))
            withTimeout(START_TIMEOUT_MS) { waiter.await() }
        } catch (error: TimeoutCancellationException) {
            abortStart(newCore)
            appContext.stopService(Intent(appContext, WalkService::class.java))
            throw WalkErrors.fromForegroundStartFailure(IllegalStateException("Служба не вышла в foreground за $START_TIMEOUT_MS мс"))
        } catch (error: WalkServiceError) {
            abortStart(newCore)
            throw error
        } catch (error: Exception) {
            // ForegroundServiceStartNotAllowedException, SecurityException, IllegalStateException.
            abortStart(newCore)
            throw WalkErrors.fromForegroundStartFailure(error)
        } finally {
            if (pendingStart === waiter) pendingStart = null
        }
    }

    /** Stop requested by Dart. Idempotent. */
    fun stop() {
        val current = core ?: return
        core = null
        pendingStart?.completeExceptionally(WalkErrors.invalidArgument("Прогулка остановлена во время запуска."))
        // The session is removed from the service before it is released.
        service?.stopWalk(current)
        current.release()
    }

    fun onServiceCreated(created: WalkService) {
        service = created
    }

    fun onServiceStarted(started: WalkService) {
        service = started
        pendingStart?.complete(Unit)
    }

    fun onServiceStartFailed(failed: WalkService, error: Throwable) {
        if (service === failed) service = null
        // Released here, before the service's onDestroy, so it is not reported as a stopped walk.
        core?.release()
        core = null
        pendingStart?.completeExceptionally(error) ?: Log.w(TAG, "Foreground start failed without a waiting caller", error)
    }

    /**
     * The service is gone. If Dart did not stop the walk (the system or the user killed the
     * service), the session is released and Dart is told with `onSessionStopped`.
     */
    fun onServiceDestroyed(destroyed: WalkService) {
        if (service !== destroyed) return
        service = null
        val current = core ?: return
        core = null
        current.release()
        if (pendingStart != null) {
            pendingStart?.completeExceptionally(IllegalStateException("Служба остановлена во время запуска"))
            return
        }
        dispatcher.onSessionStopped()
    }

    private fun abortStart(aborted: WalkSessionCore) {
        aborted.release()
        if (core === aborted) core = null
    }
}
