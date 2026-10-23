package online.otgolosok.walk_service

import online.otgolosok.walk_service.notification.CardText
import online.otgolosok.walk_service.notification.LiveUpdatePlanner
import online.otgolosok.walk_service.notification.NotificationThrottle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveUpdatePlannerTest {
    private val texts = Fixtures.texts

    @Test
    fun `no Live Update below Android 16`() {
        assertNull(LiveUpdatePlanner.content(35, canPostPromoted = true, Fixtures.card(), texts))
        assertNotNull(LiveUpdatePlanner.content(36, canPostPromoted = true, Fixtures.card(), texts))
        assertNotNull(LiveUpdatePlanner.content(37, canPostPromoted = true, Fixtures.card(), texts))
    }

    @Test
    fun `nothing is posted when promotion is not allowed`() {
        assertNull(LiveUpdatePlanner.content(36, canPostPromoted = false, Fixtures.card(), texts))
    }

    @Test
    fun `only the approach stage has a Live Update`() {
        val expected = mapOf(
            CardStage.APPROACH to true,
            CardStage.PLAYING to false,
            CardStage.PAUSED to false,
            CardStage.FINISHED to false,
        )
        for ((stage, shown) in expected) {
            val content = LiveUpdatePlanner.content(36, true, Fixtures.card(stage = stage), texts)
            assertEquals("stage $stage", shown, content != null)
        }
    }

    @Test
    fun `one segment per chapter and progress equals chapters passed`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(chapterIndex = 2, chapterCount = 7), texts)!!
        assertEquals(7, content.segmentCount)
        assertEquals(2, content.progress)
        assertEquals("Часть 3 из 7", content.text)
    }

    @Test
    fun `first stop has no progress`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(chapterIndex = 0, chapterCount = 3), texts)!!
        assertEquals(0, content.progress)
        assertEquals("Часть 1 из 3", content.text)
    }

    @Test
    fun `card without chapters has no Live Update`() {
        assertNull(LiveUpdatePlanner.content(36, true, Fixtures.card(chapterIndex = 0, chapterCount = 0), texts))
    }

    @Test
    fun `title names the next stop and the chip shows the rounded distance`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(distanceM = 348.6, nextStopTitle = "Дом Нирнзее"), texts)!!
        assertEquals("До «Дом Нирнзее»", content.title)
        assertEquals("349 м", content.chip)
        assertEquals(349L, content.roundedDistanceM)
    }

    @Test
    fun `unknown distance gives no chip`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(distanceM = null), texts)!!
        assertNull(content.chip)
        assertNull(content.roundedDistanceM)
    }

    @Test
    fun `stop title falls back to the chapter title`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(nextStopTitle = null, chapterTitle = "Финиш"), texts)!!
        assertEquals("До «Финиш»", content.title)
    }
}

class NotificationThrottleTest {
    private val key = "stop-3"

    @Test
    fun `first update is always posted`() {
        assertTrue(NotificationThrottle().shouldPost(key, 400, nowMs = 0))
    }

    @Test
    fun `distance updates need 10 m and 5 s`() {
        // (distance, time since the last post, expected)
        val cases = listOf(
            Triple(395L, 6_000L, false), // 5 m: too small
            Triple(390L, 4_999L, false), // 10 m but too soon
            Triple(390L, 5_000L, true), // both limits reached
            Triple(410L, 5_000L, true), // moving away counts too
            Triple(400L, 60_000L, false), // same distance, however long
        )
        for ((distance, elapsed, expected) in cases) {
            val throttle = NotificationThrottle()
            throttle.shouldPost(key, 400, nowMs = 1_000)
            assertEquals("distance $distance after $elapsed ms", expected, throttle.shouldPost(key, distance, nowMs = 1_000 + elapsed))
        }
    }

    @Test
    fun `a new target is posted at once`() {
        val throttle = NotificationThrottle()
        throttle.shouldPost(key, 400, nowMs = 1_000)
        assertTrue(throttle.shouldPost("stop-4", 401, nowMs = 1_100))
    }

    @Test
    fun `limits count from the last post, not the last call`() {
        val throttle = NotificationThrottle()
        assertTrue(throttle.shouldPost(key, 400, nowMs = 0))
        assertFalse(throttle.shouldPost(key, 385, nowMs = 3_000))
        assertTrue(throttle.shouldPost(key, 385, nowMs = 5_000))
        assertFalse(throttle.shouldPost(key, 380, nowMs = 11_000))
    }

    @Test
    fun `distance appearing or disappearing waits only for the interval`() {
        val throttle = NotificationThrottle()
        throttle.shouldPost(key, null, nowMs = 0)
        assertFalse(throttle.shouldPost(key, 300, nowMs = 1_000))
        assertTrue(throttle.shouldPost(key, 300, nowMs = 5_000))
    }

    @Test
    fun `reset makes the next update immediate`() {
        val throttle = NotificationThrottle()
        throttle.shouldPost(key, 400, nowMs = 0)
        throttle.reset()
        assertTrue(throttle.shouldPost(key, 399, nowMs = 1))
    }
}

class CardTextTest {
    private val texts = Fixtures.texts

    @Test
    fun `approach subtitle below Android 16 shows stop and distance`() {
        assertEquals("До «Дом Нирнзее» · 120 м", CardText.approachSubtitle(texts, Fixtures.card(distanceM = 120.4)))
    }

    @Test
    fun `approach subtitle without a distance shows the stop only`() {
        assertEquals("До «Дом Нирнзее»", CardText.approachSubtitle(texts, Fixtures.card(distanceM = null)))
    }

    @Test
    fun `other stages keep the track subtitle`() {
        for (stage in listOf(CardStage.PLAYING, CardStage.PAUSED, CardStage.FINISHED)) {
            assertNull("stage $stage", CardText.approachSubtitle(texts, Fixtures.card(stage = stage)))
        }
        assertNull(CardText.approachSubtitle(texts, null))
    }

    @Test
    fun `invalid distances are not shown`() {
        for (distance in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0)) {
            assertNull("distance $distance", CardText.roundedDistance(distance))
        }
        assertEquals(0L, CardText.roundedDistance(0.4))
    }

    @Test
    fun `unknown placeholders stay in the text`() {
        assertEquals("{stop} в 5 м", CardText.format("{stop} в {distance} м", mapOf("distance" to "5")))
    }
}
