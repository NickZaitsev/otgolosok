package online.otgolosok.walk_service

import androidx.media3.common.C
import androidx.media3.common.Player
import online.otgolosok.walk_service.player.PlayerStateMapper
import online.otgolosok.walk_service.player.WalkLoadErrorPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class ForegroundPolicyTest {
    private val location = ForegroundPolicy.TYPE_LOCATION
    private val media = ForegroundPolicy.TYPE_MEDIA_PLAYBACK

    @Test
    fun `location type only for a tracked walk with permission`() {
        data class Case(val kind: SessionKind, val tracking: Boolean, val granted: Boolean, val types: Int)
        val cases = listOf(
            Case(SessionKind.WALK, tracking = true, granted = true, types = location or media),
            Case(SessionKind.WALK, tracking = true, granted = false, types = media),
            Case(SessionKind.WALK, tracking = false, granted = true, types = media),
            Case(SessionKind.LISTEN, tracking = true, granted = true, types = media),
            Case(SessionKind.LISTEN, tracking = false, granted = false, types = media),
        )
        for (case in cases) {
            assertEquals(case.toString(), case.types, ForegroundPolicy.serviceTypes(case.kind, case.tracking, case.granted))
        }
    }
}

class WalkLoadErrorPolicyTest {
    @Test
    fun `transient errors retry three times with backoff`() {
        for (status in listOf(null, 408, 429, 500, 503)) {
            val delays = (1..4).map { WalkLoadErrorPolicy.retryDelayMs(status, mediaFatal = false, errorCount = it) }
            assertEquals("status $status", listOf(500L, 1_000L, 2_000L, C.TIME_UNSET), delays)
        }
    }

    @Test
    fun `deterministic client errors are not retried`() {
        for (status in listOf(400, 401, 403, 404, 410, 416)) {
            assertEquals("status $status", C.TIME_UNSET, WalkLoadErrorPolicy.retryDelayMs(status, mediaFatal = false, errorCount = 1))
        }
    }

    @Test
    fun `errors Media3 treats as fatal are not retried`() {
        assertEquals(C.TIME_UNSET, WalkLoadErrorPolicy.retryDelayMs(null, mediaFatal = true, errorCount = 1))
    }
}

class PlayerStateMapperTest {
    @Test
    fun `maps ExoPlayer state to the contract`() {
        data class Case(val state: Int, val playWhenReady: Boolean, val error: Boolean, val expected: PlaybackState)
        val cases = listOf(
            Case(Player.STATE_IDLE, false, false, PlaybackState.IDLE),
            Case(Player.STATE_IDLE, true, true, PlaybackState.ERROR),
            Case(Player.STATE_BUFFERING, true, false, PlaybackState.BUFFERING),
            Case(Player.STATE_BUFFERING, false, false, PlaybackState.PAUSED),
            Case(Player.STATE_READY, true, false, PlaybackState.PLAYING),
            Case(Player.STATE_READY, false, false, PlaybackState.PAUSED),
            Case(Player.STATE_ENDED, true, false, PlaybackState.ENDED),
            Case(Player.STATE_ENDED, false, false, PlaybackState.ENDED),
        )
        for (case in cases) {
            assertEquals(case.toString(), case.expected, PlayerStateMapper.map(case.state, case.playWhenReady, case.error))
        }
    }
}

class PermissionResolverTest {
    @Test
    fun `resolves permanently denied from the rationale`() {
        data class Case(
            val granted: Boolean,
            val requested: Boolean,
            val rationale: Boolean?,
            val remembered: Boolean,
            val expected: PermissionStatus,
        )
        val cases = listOf(
            Case(granted = true, requested = true, rationale = false, remembered = true, expected = PermissionStatus.GRANTED),
            // Never asked: rationale is false too, but this is not a permanent denial.
            Case(granted = false, requested = false, rationale = false, remembered = false, expected = PermissionStatus.DENIED),
            Case(granted = false, requested = true, rationale = true, remembered = false, expected = PermissionStatus.DENIED),
            Case(granted = false, requested = true, rationale = false, remembered = false, expected = PermissionStatus.PERMANENTLY_DENIED),
            // No activity: the result remembered after the last request.
            Case(granted = false, requested = true, rationale = null, remembered = true, expected = PermissionStatus.PERMANENTLY_DENIED),
            Case(granted = false, requested = true, rationale = null, remembered = false, expected = PermissionStatus.DENIED),
        )
        for (case in cases) {
            assertEquals(
                case.toString(),
                case.expected,
                PermissionResolver.status(case.granted, case.requested, case.rationale, case.remembered),
            )
        }
    }
}
