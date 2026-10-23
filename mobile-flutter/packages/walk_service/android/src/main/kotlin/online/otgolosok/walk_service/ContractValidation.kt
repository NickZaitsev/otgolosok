package online.otgolosok.walk_service

/** Checks of Dart input; every violation is `invalid_argument` (a programming error in Dart). */
internal object ContractValidation {
    const val MIN_INTERVAL_MS = 500L
    const val MAX_INTERVAL_MS = 60_000L
    const val MIN_RATE = 0.25
    const val MAX_RATE = 4.0

    fun sessionConfig(config: SessionConfig) {
        if (config.locationIntervalMs !in MIN_INTERVAL_MS..MAX_INTERVAL_MS) {
            throw WalkErrors.invalidArgument("locationIntervalMs вне $MIN_INTERVAL_MS..$MAX_INTERVAL_MS: ${config.locationIntervalMs}.")
        }
        if (!config.minDistanceM.isFinite() || config.minDistanceM < 0) {
            throw WalkErrors.invalidArgument("minDistanceM должен быть конечным и неотрицательным.")
        }
        if (!config.contentRoute.startsWith("/")) {
            throw WalkErrors.invalidArgument("contentRoute должен начинаться с «/».")
        }
    }

    fun track(track: Track, allowHttp: Boolean) {
        UriPolicy.validate(track.uri, allowHttp)
        track.artworkUri?.let { UriPolicy.validate(it, allowHttp) }
        rate(track.rate)
        if (track.startPositionMs < 0) throw WalkErrors.invalidArgument("startPositionMs < 0.")
        if (track.id.isBlank()) throw WalkErrors.invalidArgument("Пустой id трека.")
    }

    fun rate(rate: Double) {
        if (!rate.isFinite() || rate < MIN_RATE || rate > MAX_RATE) {
            throw WalkErrors.invalidArgument("Скорость вне $MIN_RATE..$MAX_RATE: $rate.")
        }
    }

    fun card(card: CardState) {
        if (card.chapterCount < 0 || card.chapterIndex < 0 || card.chapterIndex > card.chapterCount) {
            throw WalkErrors.invalidArgument("Некорректные chapterIndex/chapterCount: ${card.chapterIndex}/${card.chapterCount}.")
        }
        val distance = card.distanceM
        if (distance != null && (!distance.isFinite() || distance < 0)) {
            throw WalkErrors.invalidArgument("distanceM должен быть конечным и неотрицательным.")
        }
    }
}
