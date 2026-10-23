package online.otgolosok.walk_service.notification

import online.otgolosok.walk_service.CardStage
import online.otgolosok.walk_service.CardState
import online.otgolosok.walk_service.NotificationTexts
import kotlin.math.roundToLong

/**
 * Texts of the walk card built from the localized templates in [NotificationTexts]
 * (`{stop}`, `{current}`, `{total}`, `{distance}`). `CardState.chapterIndex` is 0-based:
 * «Часть {current} из {total}» shows `chapterIndex + 1`.
 */
internal object CardText {
    private val placeholder = Regex("\\{(\\w+)\\}")

    /** Same rule as the site's `translate()`: unknown placeholders stay as they are. */
    fun format(template: String, values: Map<String, String>): String =
        placeholder.replace(template) { match -> values[match.groupValues[1]] ?: match.value }

    fun roundedDistance(distanceM: Double?): Long? =
        distanceM?.takeIf { it.isFinite() && it >= 0 }?.roundToLong()

    fun stopTitle(card: CardState): String = card.nextStopTitle?.takeIf { it.isNotBlank() } ?: card.chapterTitle

    fun toStop(texts: NotificationTexts, card: CardState): String =
        format(texts.toStop, mapOf("stop" to stopTitle(card)))

    fun partOf(texts: NotificationTexts, card: CardState): String = format(
        texts.partOf,
        mapOf("current" to (card.chapterIndex + 1).toString(), "total" to card.chapterCount.toString()),
    )

    fun distance(texts: NotificationTexts, meters: Long): String =
        format(texts.distanceMeters, mapOf("distance" to meters.toString()))

    /**
     * Below API 36 there is no Live Update: during `approach` the media notification subtitle
     * (artist line) shows «До «stop» · N м». Null in other stages: the track subtitle is shown.
     */
    fun approachSubtitle(texts: NotificationTexts, card: CardState?): String? {
        if (card == null || card.stage != CardStage.APPROACH) return null
        val toStop = toStop(texts, card)
        val meters = roundedDistance(card.distanceM) ?: return toStop
        return "$toStop · ${distance(texts, meters)}"
    }
}
