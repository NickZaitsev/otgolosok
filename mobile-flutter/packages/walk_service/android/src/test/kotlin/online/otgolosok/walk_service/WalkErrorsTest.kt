package online.otgolosok.walk_service

import android.app.ForegroundServiceStartNotAllowedException
import online.otgolosok.walk_service.location.LocationBackend
import online.otgolosok.walk_service.location.LocationSourceSelector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WalkErrorsTest {
    @Test
    fun `every refused foreground start is fgs_not_allowed`() {
        val failures = listOf(
            ForegroundServiceStartNotAllowedException("background"),
            SecurityException("location while-in-use"),
            IllegalStateException("Not allowed to start service"),
        )
        for (failure in failures) {
            assertEquals(failure.javaClass.simpleName, WalkErrorCodes.FGS_NOT_ALLOWED, WalkErrors.fromForegroundStartFailure(failure).code)
        }
    }

    @Test
    fun `audio URIs allow https, file, and http only in debug builds`() {
        data class Case(val uri: String, val allowHttp: Boolean, val valid: Boolean)
        val cases = listOf(
            Case("https://otgolosok.online/api/story-audio/a.mp3", allowHttp = false, valid = true),
            Case("HTTPS://otgolosok.online/a.mp3", allowHttp = false, valid = true),
            Case("file:///data/user/0/online.otgolosok.app/files/walk-packs/a.mp3", allowHttp = false, valid = true),
            Case("http://10.0.2.2:3000/a.mp3", allowHttp = true, valid = true),
            Case("http://10.0.2.2:3000/a.mp3", allowHttp = false, valid = false),
            Case("https:///a.mp3", allowHttp = false, valid = false),
            Case("file:///", allowHttp = false, valid = false),
            Case("content://media/external/audio/1", allowHttp = true, valid = false),
            Case("ftp://example.org/a.mp3", allowHttp = true, valid = false),
            Case("/sdcard/a.mp3", allowHttp = true, valid = false),
            Case("https://exa mple.org/a.mp3", allowHttp = false, valid = false),
            Case("", allowHttp = true, valid = false),
        )
        for (case in cases) {
            val error = runCatching { UriPolicy.validate(case.uri, case.allowHttp) }.exceptionOrNull()
            if (case.valid) {
                assertEquals(case.toString(), null, error)
            } else {
                assertEquals(case.toString(), WalkErrorCodes.INVALID_ARGUMENT, (error as WalkServiceError).code)
            }
        }
    }

    @Test
    fun `invalid Dart input is invalid_argument`() {
        val calls = listOf<() -> Unit>(
            { ContractValidation.sessionConfig(Fixtures.config(intervalMs = 0)) },
            { ContractValidation.sessionConfig(Fixtures.config(minDistanceM = -1.0)) },
            { ContractValidation.sessionConfig(Fixtures.config(minDistanceM = Double.NaN)) },
            { ContractValidation.sessionConfig(Fixtures.config(contentRoute = "walk")) },
            { ContractValidation.track(Fixtures.track(rate = 0.0), allowHttp = false) },
            { ContractValidation.track(Fixtures.track(rate = Double.NaN), allowHttp = false) },
            { ContractValidation.track(Fixtures.track(startPositionMs = -1), allowHttp = false) },
            { ContractValidation.track(Fixtures.track(artworkUri = "javascript:alert(1)"), allowHttp = false) },
            { ContractValidation.card(Fixtures.card(chapterIndex = 8, chapterCount = 7)) },
            { ContractValidation.card(Fixtures.card(distanceM = Double.POSITIVE_INFINITY)) },
        )
        calls.forEachIndexed { index, call ->
            val error = assertThrows("call #$index", WalkServiceError::class.java) { call() }
            assertEquals("call #$index", WalkErrorCodes.INVALID_ARGUMENT, error.code)
        }
    }

    @Test
    fun `valid Dart input passes`() {
        ContractValidation.sessionConfig(Fixtures.config())
        ContractValidation.track(Fixtures.track(artworkUri = "https://otgolosok.online/api/place-images/a.jpg"), allowHttp = false)
        ContractValidation.card(Fixtures.card(stage = CardStage.FINISHED, chapterIndex = 7, chapterCount = 7))
    }

    @Test
    fun `player calls without a session are invalid_argument`() {
        val error = assertThrows(WalkServiceError::class.java) { WalkSessionManager.requireActive() }
        assertEquals(WalkErrorCodes.INVALID_ARGUMENT, error.code)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocationSourceSelectorTest {
    @Test
    fun `fused provider only with Google Play services`() {
        assertEquals(LocationBackend.FUSED, LocationSourceSelector.select { true })
        assertEquals(LocationBackend.PLATFORM, LocationSourceSelector.select { false })
    }

    @Test
    fun `a failing availability check falls back to the platform provider`() {
        assertEquals(LocationBackend.PLATFORM, LocationSourceSelector.select { throw IllegalStateException("no gms") })
    }
}
