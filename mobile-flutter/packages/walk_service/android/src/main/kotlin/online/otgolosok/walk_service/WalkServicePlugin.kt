package online.otgolosok.walk_service

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.ActivityCompat
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.JSONMethodCodec
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import online.otgolosok.walk_service.location.CurrentLocation
import online.otgolosok.walk_service.location.locationServicesEnabled

/**
 * Android side of the walk service contract (`pigeons/walk_service_api.dart`).
 *
 * Works with an engine that has no activity (the engine belongs to the Application and survives
 * a swipe from Recents): only the permission requests need one, and without it returns the current
 * state without asking. All host calls arrive and all Dart calls are made on the main thread.
 */
class WalkServicePlugin :
    FlutterPlugin,
    ActivityAware,
    WalkServiceHostApi,
    PluginRegistry.RequestPermissionsResultListener,
    WalkEvents {
    private var context: Context? = null
    private var flutterApi: WalkServiceFlutterApi? = null
    private var navigationChannel: MethodChannel? = null
    private var activityBinding: ActivityPluginBinding? = null
    private var permissionMemory: PermissionMemory? = null
    private var pendingPermission: Pair<Int, CompletableDeferred<Boolean>>? = null
    private var currentLocation: CurrentLocation? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val newIntentListener = PluginRegistry.NewIntentListener { intent ->
        handleRouteIntent(intent)
        false
    }

    // region FlutterPlugin / ActivityAware

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        permissionMemory = PermissionMemory(binding.applicationContext)
        flutterApi = WalkServiceFlutterApi(binding.binaryMessenger)
        navigationChannel = MethodChannel(binding.binaryMessenger, NAVIGATION_CHANNEL, JSONMethodCodec.INSTANCE)
        WalkServiceHostApi.setUp(binding.binaryMessenger, this)
        WalkSessionManager.events = this
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        WalkServiceHostApi.setUp(binding.binaryMessenger, null)
        if (WalkSessionManager.events === this) WalkSessionManager.events = null
        scope.coroutineContext.cancelChildren()
        currentLocation?.cancelAll()
        currentLocation = null
        flutterApi = null
        navigationChannel = null
        context = null
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activityBinding = binding
        binding.addRequestPermissionsResultListener(this)
        binding.addOnNewIntentListener(newIntentListener)
        handleRouteIntent(binding.activity.intent)
    }

    override fun onDetachedFromActivityForConfigChanges() = onDetachedFromActivity()

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) = onAttachedToActivity(binding)

    override fun onDetachedFromActivity() {
        activityBinding?.let {
            it.removeRequestPermissionsResultListener(this)
            it.removeOnNewIntentListener(newIntentListener)
        }
        activityBinding = null
        // A request without an activity cannot finish: answer with the current state.
        pendingPermission?.second?.complete(false)
    }

    // endregion

    // region WalkServiceHostApi

    override suspend fun startSession(config: SessionConfig) {
        ContractValidation.sessionConfig(config)
        WalkSessionManager.start(requireContext(), config)
    }

    override fun stopSession() = WalkSessionManager.stop()

    override fun isSessionActive(): Boolean = WalkSessionManager.isActive

    override fun play(track: Track) {
        val core = WalkSessionManager.requireActive()
        ContractValidation.track(track, allowHttp())
        try {
            core.play(track)
        } catch (error: IllegalStateException) {
            throw WalkErrors.playerError("Плеер не принял трек: ${error.message}", error)
        } catch (error: IllegalArgumentException) {
            throw WalkErrors.playerError("Плеер не принял трек: ${error.message}", error)
        }
    }

    override fun pause() = WalkSessionManager.requireActive().player.pause()

    override fun resume() = WalkSessionManager.requireActive().player.resume()

    override fun seekTo(ms: Long) = WalkSessionManager.requireActive().player.seekTo(ms)

    override fun seekBy(ms: Long) = WalkSessionManager.requireActive().player.seekBy(ms)

    override fun setRate(rate: Double) {
        val core = WalkSessionManager.requireActive()
        ContractValidation.rate(rate)
        core.player.setRate(rate)
    }

    override fun prefetch(uri: String) {
        val core = WalkSessionManager.requireActive()
        UriPolicy.validate(uri, allowHttp())
        if (UriPolicy.isRemote(uri)) core.prefetch(uri)
    }

    override fun updateCard(state: CardState) {
        val core = WalkSessionManager.requireActive()
        ContractValidation.card(state)
        core.updateCard(state)
    }

    override fun permissionState(): PermissionState {
        val context = requireContext()
        val memory = requireMemory()
        val activity = activityBinding?.activity
        val location = PermissionResolver.status(
            granted = Permissions.locationGranted(context),
            requestedBefore = memory.requestedBefore(PermissionMemory.LOCATION),
            showRationale = activity?.let { rationale(it, Manifest.permission.ACCESS_FINE_LOCATION) },
            rememberedPermanent = memory.permanent(PermissionMemory.LOCATION),
        )
        val notifications = when {
            Permissions.notificationsGranted(context) -> PermissionStatus.GRANTED
            // Below Android 13 only the app's notification switch in the settings can fix it.
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> PermissionStatus.PERMANENTLY_DENIED
            else -> PermissionResolver.status(
                granted = false,
                requestedBefore = memory.requestedBefore(PermissionMemory.NOTIFICATIONS),
                showRationale = activity?.let { rationale(it, Manifest.permission.POST_NOTIFICATIONS) },
                rememberedPermanent = memory.permanent(PermissionMemory.NOTIFICATIONS),
            )
        }
        return PermissionState(
            location = location,
            notifications = notifications,
            preciseLocation = Permissions.preciseLocationGranted(context),
        )
    }

    /**
     * Fine location (with coarse, as Android 12+ requires), then notifications on Android 13+.
     * Without an attached activity nothing is asked and the current state is returned.
     */
    override suspend fun requestPermissions(): PermissionState {
        val context = requireContext()
        val memory = requireMemory()
        if (pendingPermission != null) throw WalkErrors.invalidArgument("Запрос разрешений уже идёт.")
        if (!askLocation(context, memory, precise = true)) return permissionState()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Permissions.notificationsGranted(context)) {
            val activity = activityBinding?.activity ?: return permissionState()
            val permission = Manifest.permission.POST_NOTIFICATIONS
            if (request(activity, arrayOf(permission), NOTIFICATIONS_REQUEST_CODE)) {
                memory.remember(
                    PermissionMemory.NOTIFICATIONS,
                    permanent = !Permissions.granted(context, permission) && !rationale(activity, permission),
                )
            }
        }
        return permissionState()
    }

    override fun openAppSettings() {
        val context = requireContext()
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        openFirst(context, listOf(details, Intent(Settings.ACTION_SETTINGS)), "На устройстве нет экрана настроек приложения.")
    }

    /**
     * Fine location (with coarse, as Android 12+ requires) and nothing else. Approximate location
     * already granted is enough for the map, so the dialog is not shown again for an upgrade.
     */
    override suspend fun requestLocationPermission(): PermissionState {
        val context = requireContext()
        val memory = requireMemory()
        if (pendingPermission != null) throw WalkErrors.invalidArgument("Запрос разрешений уже идёт.")
        askLocation(context, memory, precise = false)
        return permissionState()
    }

    override fun locationServicesEnabled(): Boolean = locationServicesEnabled(requireContext())

    override fun openLocationSettings() {
        val context = requireContext()
        openFirst(
            context,
            listOf(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS), Intent(Settings.ACTION_SETTINGS)),
            "На устройстве нет экрана настроек геолокации.",
        )
    }

    override suspend fun currentLocation(priority: LocationPriority, maxAgeMs: Long, timeoutMs: Long): Fix? {
        val context = requireContext()
        val locator = currentLocation ?: CurrentLocation.create(context).also { currentLocation = it }
        return locator.current(priority, maxAgeMs, timeoutMs)
    }

    override fun cancelCurrentLocation() {
        currentLocation?.cancelAll()
    }

    // endregion

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray): Boolean {
        val pending = pendingPermission ?: return false
        if (pending.first != requestCode) return false
        // Empty results: the request was interrupted, not answered.
        pending.second.complete(grantResults.isNotEmpty())
        return true
    }

    // region WalkEvents (native → Dart)

    override fun onFix(fix: Fix) = send("onFix") { it.onFix(fix) }

    override fun onLocationStatus(status: LocationStatus, code: String?) =
        send("onLocationStatus") { it.onLocationStatus(status, code) }

    override fun onPlayer(state: PlayerState) = send("onPlayer") { it.onPlayer(state) }

    override fun onMediaCommand(command: MediaCommand) = send("onMediaCommand") { it.onMediaCommand(command) }

    override fun onSessionStopped() = send("onSessionStopped") { it.onSessionStopped() }

    // endregion

    private fun send(name: String, call: suspend (WalkServiceFlutterApi) -> Unit) {
        val api = flutterApi ?: return
        // Main.immediate: on the main thread the message is sent synchronously, keeping the order.
        scope.launch {
            try {
                call(api)
            } catch (error: WalkServiceError) {
                Log.w(TAG, "Dart did not accept $name: ${error.code}")
            }
        }
    }

    /**
     * Shows the location dialog unless the needed level ([precise] or any) is already granted.
     * Returns false when there is no activity to ask from.
     */
    private suspend fun askLocation(context: Context, memory: PermissionMemory, precise: Boolean): Boolean {
        val enough = if (precise) Permissions.preciseLocationGranted(context) else Permissions.locationGranted(context)
        if (enough) return true
        val activity = activityBinding?.activity ?: return false
        if (request(activity, Permissions.LOCATION, LOCATION_REQUEST_CODE)) {
            val granted = Permissions.locationGranted(context)
            memory.remember(
                PermissionMemory.LOCATION,
                permanent = !granted && !rationale(activity, Manifest.permission.ACCESS_FINE_LOCATION),
            )
        }
        return true
    }

    private fun openFirst(context: Context, intents: List<Intent>, missing: String) {
        val activity = activityBinding?.activity
        for (intent in intents) {
            try {
                if (activity != null) {
                    activity.startActivity(intent)
                } else {
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                return
            } catch (error: ActivityNotFoundException) {
                Log.w(TAG, "Settings screen not found: ${intent.action}")
            }
        }
        throw WalkErrors.invalidArgument(missing)
    }

    /** Returns false when the request was interrupted (activity gone, empty results). */
    private suspend fun request(activity: Activity, permissions: Array<String>, requestCode: Int): Boolean {
        val result = CompletableDeferred<Boolean>()
        pendingPermission = requestCode to result
        return try {
            ActivityCompat.requestPermissions(activity, permissions, requestCode)
            result.await()
        } finally {
            pendingPermission = null
        }
    }

    private fun rationale(activity: Activity, permission: String): Boolean =
        ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)

    /**
     * The walk card opens the launch activity with [EXTRA_ROUTE]; the route is handed to the
     * Flutter router as route information (go_router navigates to it) and removed from the intent
     * so a configuration change does not navigate again.
     */
    private fun handleRouteIntent(intent: Intent?) {
        val route = intent?.getStringExtra(EXTRA_ROUTE)?.takeIf { it.startsWith("/") } ?: return
        intent.removeExtra(EXTRA_ROUTE)
        navigationChannel?.invokeMethod("pushRouteInformation", mapOf("location" to route))
    }

    private fun allowHttp(): Boolean = (requireContext().applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun requireContext(): Context = context ?: throw WalkErrors.invalidArgument("Плагин не подключён к движку.")

    private fun requireMemory(): PermissionMemory = permissionMemory ?: throw WalkErrors.invalidArgument("Плагин не подключён к движку.")

    companion object {
        private const val TAG = "WalkServicePlugin"
        private const val NAVIGATION_CHANNEL = "flutter/navigation"
        private const val LOCATION_REQUEST_CODE = 0x5741
        private const val NOTIFICATIONS_REQUEST_CODE = 0x5742

        /** String extra of the walk card's content intent: the app route (`SessionConfig.contentRoute`). */
        const val EXTRA_ROUTE = "online.otgolosok.walk_service.extra.ROUTE"
    }
}
