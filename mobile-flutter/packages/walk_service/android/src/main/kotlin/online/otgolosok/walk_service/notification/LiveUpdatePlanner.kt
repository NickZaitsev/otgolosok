package online.otgolosok.walk_service.notification

import online.otgolosok.walk_service.CardStage
import online.otgolosok.walk_service.CardState
import online.otgolosok.walk_service.NotificationTexts
import kotlin.math.abs

/** What the Android 16 Live Update shows while the walker heads to the next stop. */
internal data class LiveUpdateContent(
    val title: String,
    val text: String,
    /** Status-bar chip (`setShortCriticalText`); null when the distance is unknown. */
    val chip: String?,
    val roundedDistanceM: Long?,
    /** One segment per chapter (stop). */
    val segmentCount: Int,
    /** Chapters already passed. */
    val progress: Int,
)

internal object LiveUpdatePlanner {
    /** Android 16 (Baklava): ProgressStyle and promoted ongoing notifications. */
    const val MIN_SDK = 36

    /** A sanity bound: walks have tens of stops, not thousands of progress segments. */
    const val MAX_SEGMENTS = 200L

    /**
     * Null means "no Live Update": an older Android, promotion not allowed by the user, a stage
     * other than `approach`, or a card without chapters.
     */
    fun content(sdkInt: Int, canPostPromoted: Boolean, card: CardState?, texts: NotificationTexts): LiveUpdateContent? {
        if (sdkInt < MIN_SDK || !canPostPromoted) return null
        if (card == null || card.stage != CardStage.APPROACH) return null
        if (card.chapterCount <= 0 || card.chapterCount > MAX_SEGMENTS) return null
        val meters = CardText.roundedDistance(card.distanceM)
        return LiveUpdateContent(
            title = CardText.toStop(texts, card),
            text = CardText.partOf(texts, card),
            chip = meters?.let { CardText.distance(texts, it) },
            roundedDistanceM = meters,
            segmentCount = card.chapterCount.toInt(),
            progress = card.chapterIndex.coerceIn(0, card.chapterCount).toInt(),
        )
    }
}

/**
 * Limits notification updates while the walker moves: the system may suppress an app that
 * updates a notification every second. A changed target (title, part, segments) is shown at
 * once; a changed distance only when it moved by at least [minDistanceDeltaM] and at least
 * [minIntervalMs] passed since the last update.
 */
internal class NotificationThrottle(
    private val minDistanceDeltaM: Long = 10,
    private val minIntervalMs: Long = 5_000,
) {
    private var lastKey: Any? = null
    private var lastDistance: Long? = null
    private var lastPostedAtMs: Long = 0
    private var posted = false

    fun shouldPost(key: Any, roundedDistanceM: Long?, nowMs: Long): Boolean {
        val decision = when {
            !posted || key != lastKey -> true
            roundedDistanceM == lastDistance -> false
            roundedDistanceM == null || lastDistance == null -> nowMs - lastPostedAtMs >= minIntervalMs
            else -> abs(roundedDistanceM - lastDistance!!) >= minDistanceDeltaM && nowMs - lastPostedAtMs >= minIntervalMs
        }
        if (decision) {
            posted = true
            lastKey = key
            lastDistance = roundedDistanceM
            lastPostedAtMs = nowMs
        }
        return decision
    }

    fun reset() {
        posted = false
        lastKey = null
        lastDistance = null
        lastPostedAtMs = 0
    }
}
