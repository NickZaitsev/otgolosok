package online.otgolosok.walk_service

import android.app.ForegroundServiceStartNotAllowedException
import android.os.Build
import online.otgolosok.walk_service.location.LocationStatusCodes
import java.net.URI
import java.net.URISyntaxException

/** FlutterError codes of the walk service contract (`pigeons/walk_service_api.dart`). */
internal object WalkErrorCodes {
    const val FGS_NOT_ALLOWED = "fgs_not_allowed"
    const val PERMISSION_DENIED = "permission_denied"
    const val LOCATION_UNAVAILABLE = "location_unavailable"
    const val PLAYER_ERROR = "player_error"
    const val INVALID_ARGUMENT = "invalid_argument"
}

internal object WalkErrors {
    fun invalidArgument(message: String): WalkServiceError =
        WalkServiceError(WalkErrorCodes.INVALID_ARGUMENT, message, null)

    fun noActiveSession(): WalkServiceError = invalidArgument("Нет активной прогулки: сначала вызовите startSession.")

    fun permissionDenied(): WalkServiceError =
        WalkServiceError(WalkErrorCodes.PERMISSION_DENIED, "Нет разрешения на геолокацию.", LocationStatusCodes.PERMISSION_MISSING)

    /** Location is switched off on the device; `details` tells it apart from a failed request. */
    fun locationDisabled(): WalkServiceError =
        WalkServiceError(WalkErrorCodes.LOCATION_UNAVAILABLE, "Геолокация на устройстве выключена.", LocationStatusCodes.LOCATION_DISABLED)

    fun locationRequestFailed(cause: Throwable): WalkServiceError =
        WalkServiceError(
            WalkErrorCodes.LOCATION_UNAVAILABLE,
            "Не удалось запросить положение: ${cause.javaClass.simpleName}.",
            LocationStatusCodes.REQUEST_FAILED,
        )

    fun playerError(message: String, cause: Throwable? = null): WalkServiceError =
        WalkServiceError(WalkErrorCodes.PLAYER_ERROR, message, cause?.javaClass?.simpleName)

    /**
     * Maps a failure to bring the walk service into the foreground. Every such failure means the
     * platform refused the start (app not visible, missing while-in-use location, background start
     * limits on API 26–30), so Dart gets one code and asks the user to tap again in the app.
     */
    fun fromForegroundStartFailure(error: Throwable): WalkServiceError {
        val reason = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                error is ForegroundServiceStartNotAllowedException -> "foreground_start_not_allowed"
            error is SecurityException -> "security_exception"
            error is IllegalStateException -> "background_start_not_allowed"
            else -> "start_failed"
        }
        return WalkServiceError(
            WalkErrorCodes.FGS_NOT_ALLOWED,
            "Система не разрешила запустить прогулку в фоне ($reason).",
            error.javaClass.simpleName,
        )
    }
}

/**
 * Allowed audio and artwork URIs: `https`, `file`, and `http` only in debuggable builds (local dev
 * server). Parsed with [java.net.URI] so the rule is testable on the JVM.
 */
internal object UriPolicy {
    fun validate(raw: String, allowHttp: Boolean): String {
        val uri = try {
            URI(raw)
        } catch (error: URISyntaxException) {
            throw WalkErrors.invalidArgument("Некорректный адрес: ${error.reason}.")
        }
        when (uri.scheme?.lowercase()) {
            "https" -> requireHost(uri)
            "http" -> {
                if (!allowHttp) throw WalkErrors.invalidArgument("Адрес http:// разрешён только в отладочной сборке.")
                requireHost(uri)
            }
            "file" -> if (uri.path.isNullOrEmpty() || uri.path == "/") {
                throw WalkErrors.invalidArgument("В адресе file:// нет пути к файлу.")
            }
            else -> throw WalkErrors.invalidArgument("Схема адреса не поддерживается: ${uri.scheme ?: "нет схемы"}.")
        }
        return raw
    }

    fun isRemote(raw: String): Boolean = raw.startsWith("https://", ignoreCase = true) ||
        raw.startsWith("http://", ignoreCase = true)

    private fun requireHost(uri: URI) {
        if (uri.host.isNullOrEmpty()) throw WalkErrors.invalidArgument("В адресе нет хоста.")
    }
}
