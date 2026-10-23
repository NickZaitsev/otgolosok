package online.otgolosok.walk_service.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

/**
 * Bounded retries of audio loading: up to [MAX_RETRIES] retries with 0.5/1/2 s backoff for
 * network errors, timeouts, 408, 429 and 5xx; other 4xx and errors Media3 treats as fatal (parser,
 * file not found, range not satisfiable) fail at once. After that the player reports an error and
 * Dart decides (retry button).
 */
@OptIn(UnstableApi::class)
internal class WalkLoadErrorPolicy : DefaultLoadErrorHandlingPolicy(MAX_RETRIES) {
    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val status = (loadErrorInfo.exception as? HttpDataSource.InvalidResponseCodeException)?.responseCode
        val mediaFatal = super.getRetryDelayMsFor(loadErrorInfo) == C.TIME_UNSET
        return retryDelayMs(status, mediaFatal, loadErrorInfo.errorCount)
    }

    companion object {
        const val MAX_RETRIES = 3
        private const val BASE_DELAY_MS = 500L
        private const val MAX_DELAY_MS = 2_000L

        /** [C.TIME_UNSET] means "do not retry". [errorCount] starts at 1. */
        fun retryDelayMs(httpStatus: Int?, mediaFatal: Boolean, errorCount: Int): Long {
            if (httpStatus != null) {
                val transient = httpStatus == 408 || httpStatus == 429 || httpStatus >= 500
                if (!transient) return C.TIME_UNSET
            } else if (mediaFatal) {
                return C.TIME_UNSET
            }
            if (errorCount > MAX_RETRIES) return C.TIME_UNSET
            val exponent = (errorCount - 1).coerceIn(0, 10)
            return (BASE_DELAY_MS shl exponent).coerceAtMost(MAX_DELAY_MS)
        }
    }
}
