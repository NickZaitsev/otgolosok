package online.otgolosok.walk_service.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * Process-wide disk cache of streamed stories (`/api/story-audio/<sha256>.mp3` is immutable).
 * A [SimpleCache] folder may be opened by one instance per process only, so it lives here for the
 * process lifetime and is never released.
 */
@OptIn(UnstableApi::class)
internal object AudioCache {
    private const val MAX_BYTES = 200L * 1024 * 1024
    private const val DIRECTORY = "walk_audio"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 20_000

    @Volatile
    private var cache: SimpleCache? = null

    fun cache(context: Context): SimpleCache = cache ?: synchronized(this) {
        cache ?: SimpleCache(
            File(context.applicationContext.cacheDir, DIRECTORY),
            LeastRecentlyUsedCacheEvictor(MAX_BYTES),
            StandaloneDatabaseProvider(context.applicationContext),
        ).also { cache = it }
    }

    private fun httpFactory(): DataSource.Factory = DefaultHttpDataSource.Factory()
        .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
        .setReadTimeoutMs(READ_TIMEOUT_MS)
        .setAllowCrossProtocolRedirects(false)

    /** Streams `http(s)` through the cache. */
    fun cachedFactory(context: Context): CacheDataSource.Factory = CacheDataSource.Factory()
        .setCache(cache(context))
        .setUpstreamDataSourceFactory(httpFactory())
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

    /** Offline copies (`file://`) are read directly: copying them into the cache wastes space. */
    fun localFactory(context: Context): DataSource.Factory = DefaultDataSource.Factory(context.applicationContext)
}
