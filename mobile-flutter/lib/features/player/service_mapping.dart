// Mapping between the walk engine (lib/walk_engine) and the walk service contract.
import 'package:walk_service/walk_service.dart' as ws;

import '../../core/i18n/translations.dart';
import '../../walk_engine/walk_session.dart' as engine;

/// Templates the native side fills itself: placeholders stay unfilled (`{current}`, `{stop}` …).
ws.NotificationTexts notificationTexts(Translations translations, AppLocale locale) {
  String t(String source) => translations.translate(locale, source);
  return ws.NotificationTexts(
    channelName: t('Прогулка'),
    liveChannelName: t('Путь к точке'),
    stopAction: t('Стоп'),
    nextAction: t('Дальше'),
    backAction: t('Назад на 15 секунд'),
    partOf: t('Часть {current} из {total}'),
    toStop: t('До «{stop}»'),
    distanceMeters: t('{distance} м'),
  );
}

/// The lock-screen card of the engine's [card]. On the way to the finish there is no chapter:
/// the card names the place the walker heads to, or the walk.
ws.CardState serviceCard(engine.CardState card, String walkTitle) {
  final count = card.chapterCount < 0 ? 0 : card.chapterCount;
  final index = card.chapterIndex.clamp(0, count);
  final distance = card.distanceM;
  return ws.CardState(
    stage: switch (card.stage) {
      engine.CardStage.approach => ws.CardStage.approach,
      engine.CardStage.playing => ws.CardStage.playing,
      engine.CardStage.paused => ws.CardStage.paused,
      engine.CardStage.finished => ws.CardStage.finished,
    },
    chapterIndex: index,
    chapterCount: count,
    chapterTitle: card.chapterTitle ?? card.nextStopTitle ?? walkTitle,
    nextStopTitle: card.nextStopTitle,
    distanceM: distance != null && distance.isFinite && distance >= 0 ? distance : null,
  );
}

engine.PositionStatus positionStatusOf(ws.LocationStatus status) => switch (status) {
      ws.LocationStatus.active => engine.PositionStatus.active,
      ws.LocationStatus.unavailable => engine.PositionStatus.unavailable,
      ws.LocationStatus.permissionDenied => engine.PositionStatus.permissionDenied,
      ws.LocationStatus.error => engine.PositionStatus.error,
    };

/// The engine's view of a player report; null for `ended`, which is a separate input
/// (`WalkSession.onTrackEnded`).
engine.PlayerSnapshot? playerSnapshotOf(ws.PlayerState state) {
  final status = switch (state.state) {
    ws.PlaybackState.idle => engine.PlayerStatus.idle,
    ws.PlaybackState.buffering => engine.PlayerStatus.loading,
    ws.PlaybackState.playing => engine.PlayerStatus.playing,
    ws.PlaybackState.paused => engine.PlayerStatus.paused,
    ws.PlaybackState.error => engine.PlayerStatus.error,
    ws.PlaybackState.ended => null,
  };
  if (status == null) return null;
  return engine.PlayerSnapshot(
    url: state.trackId,
    status: status,
    positionSec: state.positionMs < 0 ? 0 : state.positionMs / 1000,
    durationSec: state.durationMs > 0 ? state.durationMs / 1000 : null,
  );
}

/// Where the player reads a recording: the offline copy's file when it is saved (looked up by
/// chapter id, then by the site-relative URL the offline manifest uses), else the site.
String audioUri(String url, {required Uri origin, String? chapterId, Map<String, Uri> local = const {}}) {
  final saved = (chapterId == null ? null : local[chapterId]) ?? local[url];
  if (saved != null) return saved.toString();
  final parsed = Uri.parse(url);
  return parsed.hasScheme ? parsed.toString() : origin.resolveUri(parsed).toString();
}

/// Seconds as the whole milliseconds the contract carries.
int toMs(double seconds) => seconds.isFinite && seconds > 0 ? (seconds * 1000).round() : 0;
