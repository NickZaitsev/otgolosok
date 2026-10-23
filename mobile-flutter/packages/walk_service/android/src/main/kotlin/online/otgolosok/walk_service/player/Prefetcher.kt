package online.otgolosok.walk_service.player

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.cache.CacheWriter
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Writes the next chapter into [AudioCache] in the background so the story starts without
 * waiting for the network at the stop. One download at a time; [cancelAll] on session stop.
 */
@OptIn(UnstableApi::class)
internal class Prefetcher(context: Context) {
    private val appContext = context.applicationContext
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "walk-prefetch").apply { isDaemon = true }
    }
    private val lock = Any()
    private val queued = linkedSetOf<String>()
    private val tasks = mutableMapOf<String, Future<*>>()
    private var currentWriter: CacheWriter? = null

    @Volatile
    private var closed = false

    /** `http(s)` only; offline `file://` copies are already local. Repeated URIs are ignored. */
    fun prefetch(uri: String) {
        synchronized(lock) {
            if (closed || !queued.add(uri)) return
            tasks[uri] = executor.submit { download(uri) }
        }
    }

    fun cancelAll() {
        synchronized(lock) {
            tasks.values.forEach { it.cancel(true) }
            tasks.clear()
            queued.clear()
            currentWriter?.cancel()
        }
    }

    fun close() {
        closed = true
        cancelAll()
        executor.shutdownNow()
    }

    private fun download(uri: String) {
        var attempt = 0
        try {
            while (!Thread.currentThread().isInterrupted) {
                val writer = CacheWriter(
                    AudioCache.cachedFactory(appContext).createDataSourceForDownloading(),
                    DataSpec(Uri.parse(uri)),
                    null,
                    null,
                )
                synchronized(lock) {
                    if (closed) return
                    currentWriter = writer
                }
                try {
                    writer.cache()
                    return
                } catch (error: InterruptedIOException) {
                    return
                } catch (error: IOException) {
                    if (!transient(error) || attempt >= MAX_RETRIES) {
                        Log.w(TAG, "Prefetch failed: ${error.javaClass.simpleName}")
                        return
                    }
                    Thread.sleep(BASE_DELAY_MS shl attempt)
                    attempt++
                }
            }
        } catch (_: InterruptedException) {
            // Cancelled by cancelAll().
        } finally {
            synchronized(lock) {
                currentWriter = null
                tasks.remove(uri)
                // A later prefetch of the same URI is cheap: CacheWriter skips cached spans.
                queued.remove(uri)
            }
        }
    }

    private fun transient(error: IOException): Boolean {
        val status = (error as? HttpDataSource.InvalidResponseCodeException)?.responseCode ?: return true
        return status == 408 || status == 429 || status >= 500
    }

    private companion object {
        const val TAG = "WalkPrefetcher"
        const val MAX_RETRIES = 2
        const val BASE_DELAY_MS = 1_000L
    }
}
