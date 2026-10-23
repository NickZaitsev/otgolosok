package online.otgolosok.walk_service

internal object Fixtures {
    val texts = NotificationTexts(
        channelName = "Прогулка",
        liveChannelName = "Путь к точке",
        stopAction = "Стоп",
        nextAction = "Дальше",
        backAction = "Назад 15 с",
        partOf = "Часть {current} из {total}",
        toStop = "До «{stop}»",
        distanceMeters = "{distance} м",
    )

    fun card(
        stage: CardStage = CardStage.APPROACH,
        chapterIndex: Long = 2,
        chapterCount: Long = 7,
        chapterTitle: String = "Дом Нирнзее",
        nextStopTitle: String? = "Дом Нирнзее",
        distanceM: Double? = 348.6,
    ) = CardState(stage, chapterIndex, chapterCount, chapterTitle, nextStopTitle, distanceM)

    fun config(
        kind: SessionKind = SessionKind.WALK,
        tracking: Boolean = true,
        intervalMs: Long = 1_000,
        minDistanceM: Double = 0.0,
        contentRoute: String = "/walk?share=abc",
    ) = SessionConfig(kind, "Прогулка по Китай-городу", texts, tracking, intervalMs, minDistanceM, contentRoute)

    fun track(
        uri: String = "https://otgolosok.online/api/story-audio/abc.mp3",
        artworkUri: String? = null,
        rate: Double = 1.0,
        startPositionMs: Long = 0,
    ) = Track("chapter-3", uri, "Дом Нирнзее", "Часть 3 из 7", "Прогулка по Китай-городу", artworkUri, startPositionMs, rate, true)
}
