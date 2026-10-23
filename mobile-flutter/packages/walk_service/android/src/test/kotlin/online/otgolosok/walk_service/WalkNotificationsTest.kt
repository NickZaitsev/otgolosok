package online.otgolosok.walk_service

import android.app.Notification
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import online.otgolosok.walk_service.notification.LiveUpdatePlanner
import online.otgolosok.walk_service.notification.WalkNotifications
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WalkNotificationsTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun `Live Update is a promotable ProgressStyle notification with a distance chip`() {
        val content = LiveUpdatePlanner.content(36, true, Fixtures.card(chapterIndex = 2, chapterCount = 7, distanceM = 348.6), Fixtures.texts)!!
        val notification = WalkNotifications(context).buildLiveUpdate(content, contentIntent = null)

        assertTrue(NotificationCompat.isRequestPromotedOngoing(notification))
        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertEquals("349 м", notification.shortCriticalText)
        assertEquals("До «Дом Нирнзее»", notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("Часть 3 из 7", notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())

        val style = Notification.Builder.recoverBuilder(context, notification).style as Notification.ProgressStyle
        assertEquals(7, style.progressSegments.size)
        assertEquals(7, style.progressMax)
        assertEquals(2, style.progress)
    }
}
