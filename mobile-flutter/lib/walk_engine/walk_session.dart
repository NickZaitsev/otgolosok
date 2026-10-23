// The walk player's state machine: the behaviour contract of
// src/features/tour/tour-experience.tsx for universal walks (walks opened from
// a walk view), with the audio side of use-walk-audio.ts and the position
// side of use-walk-position.ts. It owns no player and no GPS: it emits
// [PlayerCommand]s and is fed fixes, position statuses and player states.
import 'dart:async';
import 'dart:math' as math;

import 'checkpoint.dart';
import 'distance.dart';
import 'route.dart';
import 'trigger.dart';
import 'walk_direction.dart';
import 'walk_plan.dart';
import 'walk_settings.dart';

// ---- Persistence -------------------------------------------------------------

/// Where resume checkpoints live. Reads are synchronous (a cached store);
/// writes may complete later but must apply in call order. Failures never
/// interrupt a walk: the session swallows them.
abstract interface class CheckpointStore {
  String? read(String key);
  Future<void> write(String key, String value);
  Future<void> remove(String key);
}

class InMemoryCheckpointStore implements CheckpointStore {
  final Map<String, String> values = {};

  @override
  String? read(String key) => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}

// ---- Inputs ------------------------------------------------------------------

/// Status of the position source (`PositionSourceStatus` plus `idle`).
enum PositionStatus { idle, starting, active, stopped, complete, permissionDenied, unavailable, error }

/// What the native player reports for the track it plays.
enum PlayerStatus { idle, loading, playing, paused, error }

class PlayerSnapshot {
  const PlayerSnapshot({
    required this.url,
    required this.status,
    required this.positionSec,
    this.durationSec,
  });

  /// The track the player holds; events of another track are ignored.
  final String? url;
  final PlayerStatus status;
  final double positionSec;
  final double? durationSec;
}

// ---- Outputs -----------------------------------------------------------------

class PlayerTrack {
  const PlayerTrack({
    required this.chapterId,
    required this.chapterIndex,
    required this.chapterCount,
    required this.url,
    required this.title,
    required this.place,
    required this.walkTitle,
    required this.durationSec,
  });

  final String chapterId;
  final int chapterIndex;
  final int chapterCount;

  /// Site-relative audio URL as the walk view carries it.
  final String url;
  final String title;
  final String place;
  final String walkTitle;
  final double? durationSec;
}

sealed class PlayerCommand {
  const PlayerCommand();
}

/// Load [track] and play it from [startPositionSec] at [rate].
final class PlayTrack extends PlayerCommand {
  const PlayTrack(this.track, this.startPositionSec, this.rate);

  final PlayerTrack track;
  final double startPositionSec;
  final double rate;
}

final class PausePlayback extends PlayerCommand {
  const PausePlayback();
}

/// Continue the loaded track where it paused.
final class ResumePlayback extends PlayerCommand {
  const ResumePlayback();
}

final class SeekTo extends PlayerCommand {
  const SeekTo(this.positionSec);

  final double positionSec;
}

final class SetRate extends PlayerCommand {
  const SetRate(this.rate);

  final double rate;
}

/// Warm the cache with the next chapter's recording.
final class PrefetchAudio extends PlayerCommand {
  const PrefetchAudio(this.url);

  final String url;
}

/// Stop the current track; [endOfWalk] when the walk itself ends.
final class StopPlayback extends PlayerCommand {
  const StopPlayback({required this.endOfWalk});

  final bool endOfWalk;
}

/// The audio state of the walk (`AudioStatus` of use-walk-audio.ts without the
/// browser-only `unlocking`/`blocked`).
enum WalkAudioStatus { locked, ready, loading, playing, paused, ended, error }

enum SignalTone { good, warning, neutral }

/// A status line: [key] is the Russian source string of getStatusText, to be
/// translated by the UI dictionary with [values] for its placeholders.
class StatusText {
  const StatusText(this.key, [this.values = const {}]);

  final String key;
  final Map<String, Object> values;

  @override
  bool operator ==(Object other) =>
      other is StatusText &&
      other.key == key &&
      other.values.length == values.length &&
      other.values.entries.every((entry) => values[entry.key] == entry.value);

  @override
  int get hashCode => Object.hash(key, Object.hashAllUnordered(values.entries.map((e) => Object.hash(e.key, e.value))));

  @override
  String toString() => 'StatusText($key, $values)';
}

/// The primary button of the card: «Дальше», «К финишу» or «Завершить».
enum NextAction { next, toFinish, finish }

class WalkUiState {
  const WalkUiState({
    required this.active,
    required this.completed,
    required this.canStart,
    required this.direction,
    required this.chapterIndex,
    required this.chapterCount,
    required this.stage,
    required this.finishLeg,
    required this.chapterId,
    required this.chapterTitle,
    required this.nextStopTitle,
    required this.nextAction,
    required this.hasPrevious,
    required this.hasNext,
    required this.leg,
    required this.target,
    required this.distanceM,
    required this.triggerPhase,
    required this.positionStatus,
    required this.lastFix,
    required this.statusText,
    required this.signalTone,
    required this.positionFailed,
    required this.positionDenied,
    required this.advance,
    required this.effectiveAdvance,
    required this.rate,
    required this.audioStatus,
    required this.audioUrl,
    required this.positionSec,
    required this.durationSec,
    required this.canSeek,
    required this.stoppedChapter,
  });

  final bool active;

  /// The walk was finished (not just stopped).
  final bool completed;

  /// The walk has a routed line to follow; the start button is disabled otherwise.
  final bool canStart;
  final WalkDirection direction;
  final int chapterIndex;
  final int chapterCount;
  final StopStage stage;
  final bool finishLeg;
  final String? chapterId;

  /// Null on the way to the finish (index == chapterCount).
  final String? chapterTitle;

  /// «Дальше: {title}».
  final String? nextStopTitle;
  final NextAction nextAction;

  /// The lock screen's «previous» is available.
  final bool hasPrevious;

  /// The lock screen's «next» is available.
  final bool hasNext;

  /// The highlighted leg of the route line (see highlightedLeg).
  final int leg;
  final GeoPoint target;
  final double? distanceM;
  final TriggerPhase triggerPhase;
  final PositionStatus positionStatus;
  final PositionFix? lastFix;
  final StatusText statusText;
  final SignalTone signalTone;
  final bool positionFailed;
  final bool positionDenied;

  /// The chosen mode.
  final AdvanceMode advance;

  /// The mode that actually works now: «По месту» without location is «По кнопке».
  final AdvanceMode effectiveAdvance;
  final double rate;
  final WalkAudioStatus audioStatus;
  final String? audioUrl;
  final double positionSec;
  final double durationSec;
  final bool canSeek;

  /// The chapter the last walk stopped at, for reopening its card.
  final int? stoppedChapter;
}

enum CardStage { approach, playing, paused, finished }

/// What the notification / Live Update card shows.
class CardState {
  const CardState({
    required this.stage,
    required this.chapterIndex,
    required this.chapterCount,
    required this.chapterTitle,
    required this.nextStopTitle,
    required this.distanceM,
  });

  final CardStage stage;
  final int chapterIndex;
  final int chapterCount;
  final String? chapterTitle;

  /// Where the walker heads now: the stop of the current target, or the finish.
  final String? nextStopTitle;
  final double? distanceM;

  @override
  bool operator ==(Object other) =>
      other is CardState &&
      other.stage == stage &&
      other.chapterIndex == chapterIndex &&
      other.chapterCount == chapterCount &&
      other.chapterTitle == chapterTitle &&
      other.nextStopTitle == nextStopTitle &&
      other.distanceM == distanceM;

  @override
  int get hashCode =>
      Object.hash(stage, chapterIndex, chapterCount, chapterTitle, nextStopTitle, distanceM);
}

// ---- Status texts (use-walk-position.ts) --------------------------------------

const String statusDenied = 'Нет доступа к геолокации · звук доступен по кнопке';
const String statusNoSignal = 'Нет сигнала GPS · звук доступен по кнопке';
const String statusReplayComplete = 'Тестовый трек завершён';
const String statusSearching = 'Ищем сигнал GPS…';
const String statusRefining = 'Уточняем позицию · ±{distance} м';
const String statusAtStop = 'Вы у точки';
const String statusPassed = 'Точка пройдена';
const String statusListening = 'Слушаем город · ±{distance} м';

bool _failed(PositionStatus status) =>
    status == PositionStatus.permissionDenied ||
    status == PositionStatus.unavailable ||
    status == PositionStatus.error;

int _round(double value) {
  final floor = value.floorToDouble();
  return (value - floor >= 0.5 ? floor + 1 : floor).toInt();
}

/// getStatusText of use-walk-position.ts.
StatusText walkStatusText(
  PositionStatus status,
  PositionFix? lastFix,
  TriggerPhase phase,
  double maxAccuracyM,
) {
  if (status == PositionStatus.permissionDenied) return const StatusText(statusDenied);
  if (status == PositionStatus.unavailable || status == PositionStatus.error) {
    return const StatusText(statusNoSignal);
  }
  if (status == PositionStatus.complete) return const StatusText(statusReplayComplete);
  if (lastFix == null) return const StatusText(statusSearching);
  if (lastFix.accuracyM > maxAccuracyM) {
    return StatusText(statusRefining, {'distance': _round(lastFix.accuracyM)});
  }
  if (phase == TriggerPhase.inside) return const StatusText(statusAtStop);
  if (phase == TriggerPhase.cooldown) return const StatusText(statusPassed);
  return StatusText(statusListening, {'distance': _round(lastFix.accuracyM)});
}

/// signalTone of use-walk-position.ts.
SignalTone walkSignalTone(PositionStatus status, PositionFix? lastFix, double maxAccuracyM) {
  if (_failed(status)) return SignalTone.warning;
  if (status == PositionStatus.active && lastFix != null && lastFix.accuracyM <= maxAccuracyM) {
    return SignalTone.good;
  }
  return lastFix != null ? SignalTone.warning : SignalTone.neutral;
}

// ---- Session -------------------------------------------------------------------

/// Marks the player as not playing the walk's audio yet; never equal to a real URL.
const String _noWalkSource = 'about:blank#no-walk-source';

class WalkSession {
  /// [route] is the published walk (forward); [reportLaunch] counts a walk
  /// launch (fire-and-forget, errors ignored); [locale] selects the checkpoint key.
  WalkSession({
    required Route route,
    required this.checkpoints,
    this.reportLaunch,
    WalkSettings settings = defaultWalkSettings,
    this.locale = PlaybackLocale.ru,
  }) : _published = route,
       _route = route,
       _advance = settings.advance,
       _rate = settings.rate {
    _chapters = getWalkChapters(_route, includePending: true);
  }

  final CheckpointStore checkpoints;
  final Future<void> Function()? reportLaunch;
  final PlaybackLocale locale;
  final StreamController<PlayerCommand> _commands = StreamController.broadcast();
  final StreamController<WalkUiState> _states = StreamController.broadcast();
  final StreamController<CardState> _cards = StreamController.broadcast();

  Route _published;
  Route _route;
  late List<RouteChapter> _chapters;
  WalkDirection _direction = WalkDirection.forward;
  AdvanceMode _advance;
  double _rate;

  bool _active = false;
  bool _completed = false;
  bool _launchReported = false;
  int _index = 0;
  StopStage _stage = StopStage.stop;
  int? _stoppedChapter;

  // Position (use-walk-position.ts diagnostics).
  PositionStatus _positionStatus = PositionStatus.idle;
  PositionFix? _lastFix;
  double? _distanceM;
  TriggerState _trigger = createTriggerState();

  // Audio (use-walk-audio.ts).
  WalkAudioStatus _audio = WalkAudioStatus.locked;
  bool _busy = false;
  String? _playbackSource;
  bool _restoringOffset = false;
  double _playbackTime = 0;
  double _mediaDuration = 0;
  PlaybackCheckpoint? _activeCheckpoint;
  double _lastSavedTime = 0;
  String? _playerUrl;
  double _playerPosition = 0;
  bool _playerError = false;
  CardState? _lastCard;

  /// Commands for the native player.
  Stream<PlayerCommand> get commands => _commands.stream;

  /// The walk screen state after every change.
  Stream<WalkUiState> get states => _states.stream;

  /// The notification card, emitted when it changes.
  Stream<CardState> get cards => _cards.stream;

  WalkUiState get state => _uiState();

  CardState get card => _cardState();

  /// The route as walked now (oriented for the chosen direction).
  Route get route => _route;

  List<RouteChapter> get chapters => List.unmodifiable(_chapters);

  bool get active => _active;

  /// Whether the walk view still has a stop with this id (a start from a stop
  /// whose id is gone shows «Точка начала больше не входит в эту прогулку»).
  bool containsStop(String stopId) => (_route.walk?.steps ?? const []).any((step) => step.id == stopId);

  // ---- Derived values (tour-experience.tsx) ----

  Poi get _firstPoi => _route.pois.first;

  GeoPoint get _finish => _route.walk?.finish.location ?? _firstPoi.viewpoint ?? _firstPoi.location;

  TriggerConfig get _baseTriggerConfig => TriggerConfig(
    enterM: _firstPoi.trigger.enterM,
    exitM: _firstPoi.trigger.exitM,
    minFixes: _firstPoi.trigger.minFixes,
    windowSize: 5,
    maxAccuracyM: _firstPoi.trigger.maxAccuracyM,
  );

  GeoPoint get _target => arrivalTarget(_chapters, _index, _stage, _finish);

  TriggerConfig get _triggerConfig => arrivalTriggerConfig(_chapters, _index, _stage, _baseTriggerConfig);

  bool get _finishLeg => _route.walk != null && hasFinishLeg(_chapters, _finish, _baseTriggerConfig.enterM);

  bool get _canStart => (_route.walk?.path.coordinates.length ?? 0) > 1;

  RouteChapter? _chapterAt(int index) => index >= 0 && index < _chapters.length ? _chapters[index] : null;

  String? _chapterSource(int index) => _chapterAt(index)?.audio?.url ?? _chapterAt(index)?.content.story.audioUrl;

  /// On the way to the finish the player keeps the last stop's story.
  RouteChapter? get _storyChapter => _chapterAt(_index) ?? (_chapters.isEmpty ? null : _chapters.last);

  String? get _currentSource => _storyChapter?.audio?.url ?? (_storyChapter?.content ?? _firstPoi.content).story.audioUrl;

  bool get _positionDenied => _positionStatus == PositionStatus.permissionDenied;

  AdvanceMode get _effectiveAdvance => _advance == AdvanceMode.place && _failed(_positionStatus) ? AdvanceMode.manual : _advance;

  List<PlaybackChapter> _playbackChapters(List<RouteChapter> chapters) => [
    for (final chapter in chapters)
      if (chapter.audio case final audio?)
        PlaybackChapter(id: chapter.id, audioUrl: audio.url, durationSec: audio.durationSec),
  ];

  String _checkpointKey(WalkDirection direction) => walkCheckpointKey(_published.id, locale, direction);

  /// The resume point of a walk in [direction], if its recording is unchanged.
  PlaybackCheckpoint? savedCheckpoint([WalkDirection direction = WalkDirection.forward]) {
    final route = orientWalk(_published, direction);
    final chapters = getWalkChapters(route, includePending: true);
    String? raw;
    try {
      raw = checkpoints.read(_checkpointKey(direction));
    } on Object {
      raw = null;
    }
    return parsePlaybackCheckpoint(raw, route.id, _playbackChapters(chapters));
  }

  /// The chapter the saved checkpoint belongs to, or -1.
  int savedChapterIndex([WalkDirection direction = WalkDirection.forward]) {
    final saved = savedCheckpoint(direction);
    if (saved == null) return -1;
    final chapters = getWalkChapters(orientWalk(_published, direction), includePending: true);
    return chapters.indexWhere((chapter) => chapter.id == saved.chapterId);
  }

  // ---- Walk lifecycle ----

  /// startTour: starts at [index], else at the stop [fromStop] (forward only),
  /// else at the saved checkpoint when [resume], else at the first stop.
  /// Returns false when a walk is running or the walk has no route line yet.
  bool start({bool resume = true, String? fromStop, int? index, WalkDirection direction = WalkDirection.forward}) {
    if (_active) return false;
    final chosen = fromStop != null ? WalkDirection.forward : direction;
    final route = orientWalk(_published, chosen);
    final chapters = getWalkChapters(route, includePending: true);
    int? requested = index;
    if (requested == null && fromStop != null) {
      requested = chapters.indexWhere((chapter) => chapter.id == fromStop);
      if (requested < 0) throw ArgumentError.value(fromStop, 'fromStop', 'Stop is not in this walk');
    }
    if ((route.walk?.path.coordinates.length ?? 0) <= 1) return false;

    _direction = chosen;
    _route = route;
    _chapters = chapters;
    final saved = resume ? savedCheckpoint(chosen) : null;
    final savedIndex = saved == null ? -1 : chapters.indexWhere((chapter) => chapter.id == saved.chapterId);
    final initialIndex = requested != null && requested >= 0 && requested < chapters.length
        ? requested
        : savedIndex >= 0
        ? savedIndex
        : 0;
    final initialPosition = requested == null && saved != null ? saved.positionSec : 0.0;
    final startUrl = _chapterSource(initialIndex) ?? _firstPoi.content.story.audioUrl;
    // A universal walk starts on the way to the stop, unless the walker listens
    // in a row or continues a story they had already been listening to.
    final initialStage = _advance != AdvanceMode.sequence && initialPosition < 1 ? StopStage.approach : StopStage.stop;

    _completed = false;
    _active = true;
    _index = initialIndex;
    _stage = initialStage;
    if (initialStage == StopStage.approach) {
      _prime(initialIndex);
    } else {
      _begin(initialIndex, initialPosition, startUrl);
    }
    _reportLaunchOnce();
    _positionStatus = PositionStatus.idle;
    _lastFix = null;
    _showStop(initialIndex, initialStage);
    _publish();
    return true;
  }

  /// stopTour: ends the walk; [completed] clears the resume checkpoint.
  void stop({bool completed = false}) {
    if (!_active) return;
    _completed = completed;
    _end(completed);
    _active = false;
    _positionStatus = PositionStatus.idle;
    _lastFix = null;
    _distanceM = null;
    _trigger = createTriggerState();
    _stoppedChapter = math.min(_index, _chapters.length - 1);
    _publish();
  }

  /// selectChapter: shows chapter [index]; plays it now only in «Подряд».
  void selectChapter(int index) {
    _selectChapter(index);
    _publish();
  }

  /// The card's primary button: «Дальше», «К финишу», or «Завершить».
  void next() {
    if (!_active) return;
    if (_index + 1 < _chapters.length || (_finishLeg && _index + 1 == _chapters.length)) {
      _selectChapter(_index + 1);
      _publish();
    } else {
      stop(completed: true);
    }
  }

  /// The lock screen's «next»: only to another stop.
  void skipToNext() {
    if (_index + 1 < _chapters.length) selectChapter(_index + 1);
  }

  /// «Предыдущая остановка» on the card and on the lock screen.
  void previous() {
    if (_index > 0) selectChapter(_index - 1);
  }

  /// «По месту»: reaching the stop starts its story; reaching the next one moves on to it.
  void arriveByPlace() {
    _arriveByPlace();
    _publish();
  }

  // ---- Audio controls ----

  /// Play/pause from the card or the lock screen (toggleAudio): pressing play
  /// on the way to a stop means the walker is there.
  void toggle() {
    if (!_active) return;
    _arrive();
    _toggle();
    _publish();
  }

  void play() {
    if (_audio == WalkAudioStatus.playing || _audio == WalkAudioStatus.loading) return;
    toggle();
  }

  void pause() {
    if (_audio != WalkAudioStatus.playing && _audio != WalkAudioStatus.loading) return;
    toggle();
  }

  void seekTo(double positionSec) {
    _seek(positionSec);
    _publish();
  }

  void seekBy(double offsetSec) {
    _seek(_playbackTime + offsetSec);
    _publish();
  }

  void setAdvanceMode(AdvanceMode mode) {
    _advance = mode;
    _publish();
  }

  void setRate(double rate) {
    if (!playbackRates.contains(rate)) throw ArgumentError.value(rate, 'rate', 'Unsupported playback rate');
    _rate = rate;
    if (_active) _command(SetRate(rate));
    _publish();
  }

  /// Saves the resume point now (the app goes to the background).
  void persist() {
    final checkpoint = _activeCheckpoint;
    if (_active && checkpoint != null) _save(checkpoint);
  }

  // ---- Inputs ----

  /// A position fix: runs the trigger for the stop the walk listens for, with
  /// arrivals withheld while a recording plays.
  void onFix(PositionFix fix) {
    if (!_active) return;
    final result = processFix(_trigger, fix, _target, _triggerConfig, _busy);
    _trigger = result.state;
    _lastFix = fix;
    _distanceM = result.distanceM;
    if (result.event?.type == TriggerEventType.entered) _arriveByPlace();
    _publish();
  }

  void onPositionStatus(PositionStatus status) {
    if (!_active) return;
    _positionStatus = status;
    _publish();
  }

  void onPlayerState(PlayerSnapshot snapshot) {
    if (!_active) return;
    _playerUrl = snapshot.url;
    _playerPosition = snapshot.positionSec;
    _playerError = snapshot.status == PlayerStatus.error;
    if (!_owns(snapshot.url)) return;
    switch (snapshot.status) {
      case PlayerStatus.idle:
        return;
      case PlayerStatus.error:
        _busy = false;
        _audio = WalkAudioStatus.error;
      case PlayerStatus.loading:
        _timeUpdate(snapshot);
      case PlayerStatus.playing:
        // The first report of a started track: its start offset is applied.
        _restoringOffset = false;
        _timeUpdate(snapshot);
        _busy = true;
        _audio = WalkAudioStatus.playing;
      case PlayerStatus.paused:
        _busy = false;
        _timeUpdate(snapshot, persist: true);
        if (_audio == WalkAudioStatus.playing || _audio == WalkAudioStatus.loading) {
          _audio = WalkAudioStatus.paused;
        }
    }
    _publish();
  }

  /// The track [url] played to its end: in «Подряд» the next chapter starts.
  void onTrackEnded(String url) {
    if (!_active || !_owns(url)) return;
    _busy = false;
    if (_mediaDuration > 0) _playbackTime = _mediaDuration;
    _sync(persist: true);
    _audio = WalkAudioStatus.ended;
    if (_advance == AdvanceMode.sequence && _index + 1 < _chapters.length) {
      _selectChapter(_index + 1);
    }
    _publish();
  }

  /// The walk view changed (a stop joined it): keeps the walker at their stop (followChapter).
  void updateRoute(Route published) {
    _published = published;
    final route = orientWalk(published, _active ? _direction : WalkDirection.forward);
    final chapters = getWalkChapters(route, includePending: true);
    final before = [for (final chapter in _chapters) chapter.id];
    final after = [for (final chapter in chapters) chapter.id];
    _route = route;
    _chapters = chapters;
    if (before.join('\n') != after.join('\n')) {
      _index = followChapter(before, after, _index, _stage);
      if (_active) {
        _trigger = createTriggerState();
        _distanceM = null;
      }
    }
    _publish();
  }

  Future<void> dispose() async {
    await Future.wait([_commands.close(), _states.close(), _cards.close()]);
  }

  // ---- tour-experience.tsx internals ----

  void _showStop(int index, StopStage stage) {
    _index = index;
    _stage = stage;
    _trigger = createTriggerState();
    _distanceM = null;
  }

  void _selectChapter(int index) {
    if (!_active || index < 0) return;
    if (index == _chapters.length && _finishLeg) {
      // The last story keeps playing while the walker heads to the finish.
      _showStop(index, StopStage.approach);
      return;
    }
    if (index >= _chapters.length) return;
    final playNow = _advance == AdvanceMode.sequence;
    _showStop(index, playNow ? StopStage.stop : StopStage.approach);
    _switchTo(index, _chapterSource(index), autoplay: playNow);
  }

  void _arrive() {
    if (_stage == StopStage.approach && _index < _chapters.length) _showStop(_index, StopStage.stop);
  }

  void _arriveByPlace() {
    if (_advance != AdvanceMode.place || !_active) return;
    final count = _chapters.length;
    // The trigger listens for the finish on the way there and after the last stop.
    if (_finishLeg && (_index == count || (_index == count - 1 && _stage == StopStage.stop))) {
      stop(completed: true);
    } else if (_stage == StopStage.approach) {
      _arrive();
      _play(_chapterSource(_index), 0);
    } else if (_index + 1 < count) {
      final next = _index + 1;
      _showStop(next, StopStage.stop);
      _switchTo(next, _chapterSource(next), autoplay: true);
    }
  }

  void _reportLaunchOnce() {
    final report = reportLaunch;
    // Like useLaunchReport: once per screen (session object), fire-and-forget.
    if (_launchReported || report == null) return;
    _launchReported = true;
    try {
      unawaited(report().catchError((Object _) {}));
    } on Object {
      // A failed launch count never blocks the walk.
    }
  }

  // ---- use-walk-audio.ts internals ----

  bool _owns(String? url) => _playbackSource == null || url == _playbackSource;

  void _timeUpdate(PlayerSnapshot snapshot, {bool persist = false}) {
    if (_restoringOffset) return;
    _playbackTime = snapshot.positionSec;
    final duration = snapshot.durationSec;
    if (duration != null && duration.isFinite) _mediaDuration = duration;
    _sync(persist: persist);
  }

  void _sync({bool persist = false}) {
    if (!_active || _restoringOffset) return;
    final checkpoint = _activeCheckpoint;
    if (checkpoint == null) return;
    _activeCheckpoint = checkpoint.at(_playbackTime);
    if (persist || (_playbackTime - _lastSavedTime).abs() >= 2) {
      _save(_activeCheckpoint!);
      _lastSavedTime = _playbackTime;
    }
  }

  void _setChapterCheckpoint(int index, [double positionSec = 0]) {
    final audio = _chapterAt(index)?.audio;
    _activeCheckpoint = audio == null
        ? null
        : PlaybackCheckpoint(routeId: _route.id, chapterId: _chapters[index].id, audioUrl: audio.url, positionSec: positionSec);
    _lastSavedTime = positionSec;
    final checkpoint = _activeCheckpoint;
    if (checkpoint != null) _save(checkpoint);
  }

  void _play(String? url, double positionSec, {bool resume = false}) {
    if (!_active) return;
    _busy = true;
    final reuse = resume && url != null && !_playerError && _playerUrl == url && (_playerPosition - positionSec).abs() < 0.5;
    _playbackSource = url;
    _restoringOffset = !reuse && positionSec > 0;
    _playbackTime = positionSec;
    if (!reuse) _mediaDuration = 0;
    _audio = WalkAudioStatus.loading;
    if (url == null) {
      _busy = false;
      _restoringOffset = false;
      _audio = WalkAudioStatus.ready;
      return;
    }
    if (reuse) {
      _command(const ResumePlayback());
      return;
    }
    _command(PlayTrack(_trackFor(url), positionSec, _rate));
    final following = _chapterAt(_index + 1)?.audio?.url;
    if (following != null && following != url) _command(PrefetchAudio(following));
  }

  PlayerTrack _trackFor(String url) {
    final chapter = _storyChapter;
    return PlayerTrack(
      chapterId: chapter?.id ?? _firstPoi.id,
      chapterIndex: math.min(_index, math.max(0, _chapters.length - 1)),
      chapterCount: _chapters.length,
      url: url,
      title: chapter?.title ?? _firstPoi.content.story.opening,
      place: chapter?.step.place ?? _route.title,
      walkTitle: _route.title,
      durationSec: chapter?.audio?.durationSec,
    );
  }

  void _toggle() {
    if (!_active) return;
    if (_audio == WalkAudioStatus.playing || _audio == WalkAudioStatus.loading) {
      _sync(persist: true);
      _command(const PausePlayback());
      _busy = false;
      _audio = WalkAudioStatus.paused;
      return;
    }
    final position = _audio == WalkAudioStatus.ended ? 0.0 : _activeCheckpoint?.positionSec ?? _playbackTime;
    _play(_currentSource, position, resume: _audio == WalkAudioStatus.paused);
  }

  void _seek(double target) {
    if (!_active || _audio == WalkAudioStatus.loading) return;
    if (!target.isFinite || !_mediaDuration.isFinite || _mediaDuration <= 0) return;
    final position = target.clamp(0, _mediaDuration).toDouble();
    _command(SeekTo(position));
    _restoringOffset = false;
    _playbackTime = position;
    final checkpoint = _activeCheckpoint;
    if (checkpoint != null) _activeCheckpoint = checkpoint.at(position);
    _sync(persist: true);
    if (_audio == WalkAudioStatus.ended && position < _mediaDuration) _audio = WalkAudioStatus.paused;
  }

  /// Starts a walk without playing: the walker first goes to the stop.
  void _prime(int index) {
    _playbackSource = _noWalkSource;
    _restoringOffset = false;
    _setChapterCheckpoint(index);
    _playbackTime = 0;
    _mediaDuration = 0;
    _busy = false;
    _audio = WalkAudioStatus.ready;
  }

  /// Starts the audio side of a walk that begins at a stop.
  void _begin(int index, double positionSec, String? url) {
    _setChapterCheckpoint(index, positionSec);
    _playbackTime = positionSec;
    _audio = url != null ? WalkAudioStatus.loading : WalkAudioStatus.ready;
    _busy = url != null;
    if (url != null) _play(url, positionSec);
  }

  void _switchTo(int index, String? url, {required bool autoplay}) {
    _command(const StopPlayback(endOfWalk: false));
    // Late events of the stopped story must not show its time for this chapter.
    _playbackSource = _noWalkSource;
    _busy = false;
    _audio = WalkAudioStatus.ready;
    _setChapterCheckpoint(index);
    _playbackTime = 0;
    _mediaDuration = 0;
    _restoringOffset = false;
    if (url != null && autoplay) _play(url, 0);
  }

  void _end(bool completed) {
    _sync(persist: true);
    final key = _checkpointKey(_direction);
    final checkpoint = _activeCheckpoint;
    if (completed) {
      _guarded(() => checkpoints.remove(key));
    } else if (checkpoint != null) {
      _save(checkpoint);
    }
    _activeCheckpoint = null;
    _busy = false;
    _restoringOffset = false;
    _command(const StopPlayback(endOfWalk: true));
    _audio = WalkAudioStatus.locked;
    _playbackSource = null;
  }

  void _save(PlaybackCheckpoint checkpoint) {
    final key = _checkpointKey(_direction);
    _guarded(() => checkpoints.write(key, checkpoint.serialize()));
  }

  /// Storage restrictions must not prevent listening.
  void _guarded(Future<void> Function() operation) {
    try {
      unawaited(operation().catchError((Object _) {}));
    } on Object {
      // A synchronous failure of the store is ignored the same way.
    }
  }

  void _command(PlayerCommand command) {
    if (!_commands.isClosed) _commands.add(command);
  }

  // ---- Outputs ----

  WalkUiState _uiState() {
    final count = _chapters.length;
    final chapter = _chapterAt(_index);
    final following = _active && _index + 1 < count ? _chapters[_index + 1].title : null;
    final maxAccuracyM = _baseTriggerConfig.maxAccuracyM;
    return WalkUiState(
      active: _active,
      completed: _completed,
      canStart: _canStart,
      direction: _direction,
      chapterIndex: _index,
      chapterCount: count,
      stage: _stage,
      finishLeg: _finishLeg,
      chapterId: chapter?.id,
      chapterTitle: chapter?.title,
      nextStopTitle: following,
      nextAction: _index + 1 < count
          ? NextAction.next
          : _finishLeg && _index + 1 == count
          ? NextAction.toFinish
          : NextAction.finish,
      hasPrevious: _index > 0,
      hasNext: _index + 1 < count,
      leg: highlightedLeg(_index, _stage, count),
      target: _target,
      distanceM: _distanceM,
      triggerPhase: _trigger.phase,
      positionStatus: _positionStatus,
      lastFix: _lastFix,
      statusText: walkStatusText(_positionStatus, _lastFix, _trigger.phase, maxAccuracyM),
      signalTone: walkSignalTone(_positionStatus, _lastFix, maxAccuracyM),
      positionFailed: _failed(_positionStatus),
      positionDenied: _positionDenied,
      advance: _advance,
      effectiveAdvance: _effectiveAdvance,
      rate: _rate,
      audioStatus: _audio,
      audioUrl: _currentSource,
      positionSec: _playbackTime,
      durationSec: _mediaDuration > 0
          ? _mediaDuration
          : chapter?.audio?.durationSec ?? (_storyChapter?.content ?? _firstPoi.content).story.durationSec.toDouble(),
      canSeek: _mediaDuration > 0 && _audio != WalkAudioStatus.loading && _audio != WalkAudioStatus.locked,
      stoppedChapter: _stoppedChapter,
    );
  }

  CardState _cardState() {
    final count = _chapters.length;
    final chapter = _chapterAt(_index);
    final CardStage stage;
    if (!_active) {
      stage = CardStage.finished;
    } else if (_audio == WalkAudioStatus.playing || _audio == WalkAudioStatus.loading) {
      stage = CardStage.playing;
    } else if (_audio == WalkAudioStatus.paused) {
      stage = CardStage.paused;
    } else {
      stage = CardStage.approach;
    }
    // The place the trigger listens for now.
    final targetIndex = _stage == StopStage.approach ? _index : _index + 1;
    final finishTitle = _route.walk?.finish.address;
    return CardState(
      stage: stage,
      chapterIndex: _index,
      chapterCount: count,
      chapterTitle: chapter?.title,
      nextStopTitle: _chapterAt(targetIndex)?.title ?? (targetIndex >= count ? finishTitle : null),
      distanceM: _distanceM,
    );
  }

  void _publish() {
    if (!_states.isClosed) _states.add(_uiState());
    final card = _cardState();
    if (card != _lastCard) {
      _lastCard = card;
      if (!_cards.isClosed) _cards.add(card);
    }
  }
}
