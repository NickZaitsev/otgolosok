import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' hide Route;
import 'package:walk_service/walk_service.dart' as ws;

import '../../core/i18n/translations.dart';
import '../../core/settings/settings_store.dart' as prefs;
import '../../walk_engine/checkpoint.dart';
import '../../walk_engine/route.dart';
import '../../walk_engine/trigger.dart';
import '../../walk_engine/walk_direction.dart';
import '../../walk_engine/walk_plan.dart';
import '../../walk_engine/walk_route.dart';
import '../../walk_engine/walk_session.dart';
import '../../walk_engine/walk_settings.dart';
import '../../walk_engine/walk_view.dart';
import '../walks/walk_link.dart';
import 'checkpoint_store.dart';
import 'replay_source.dart';
import 'service_errors.dart';
import 'service_mapping.dart';
import 'walk_service_hub.dart';

/// Binds one [WalkSession] (the walk logic, pure Dart) to the native walk service: engine
/// commands become host calls, native events become engine inputs, the engine's card goes to
/// the lock screen. Lives as long as the walk screen shows this walk.
class WalkPlayerController extends ChangeNotifier implements SessionOwner {
  WalkPlayerController({
    required WalkView view,
    required this.link,
    required this.hub,
    required this.settings,
    required this.origin,
    required this.translations,
    required this.locale,
    this._localAudio = const {},
    void Function()? reportLaunch,
    this.onActiveChanged,
    CheckpointStore? checkpoints,
  }) : _view = view {
    final store = checkpoints ?? SettingsCheckpointStore(settings);
    session = WalkSession(
      route: walkViewToRoute(view),
      checkpoints: store,
      reportLaunch: reportLaunch == null ? null : () async => reportLaunch(),
      settings: WalkSettings(advance: _engineMode(settings.advanceMode), rate: settings.rate),
      locale: _playbackLocale(view.locale),
    );
    _subscriptions = [
      session.commands.listen(_onCommand),
      session.states.listen(_onState),
      session.cards.listen(_onCard),
    ];
    _lifecycle = AppLifecycleListener(onStateChange: _onLifecycle);
    _replay = ReplayPositionSource(onFix: _onReplayFix, onComplete: () => session.onPositionStatus(PositionStatus.complete));
  }

  final WalkLink link;
  final WalkServiceHub hub;
  final prefs.SettingsStore settings;
  final Uri origin;
  final Translations translations;
  final AppLocale locale;

  /// Called when the walk starts or ends (the router asks before leaving a running walk).
  final void Function(bool active)? onActiveChanged;

  late final WalkSession session;
  late final List<StreamSubscription<Object>> _subscriptions;
  late final AppLifecycleListener _lifecycle;
  late final ReplayPositionSource _replay;

  WalkView _view;
  Map<String, Uri> _localAudio;
  bool _starting = false;
  bool _disposed = false;
  bool _wasActive = false;
  String? _error;
  String? _endedTrack;
  ws.PermissionState? _permissions;
  bool _diagnostics = false;
  Future<void> _calls = Future.value();

  @override
  SessionOwnerKind get ownerKind => SessionOwnerKind.walk;

  WalkView get view => _view;
  WalkUiState get state => session.state;
  Route get route => session.route;
  List<RouteChapter> get chapters => session.chapters;

  /// «Запускаем прогулку…»: the service is coming to the foreground.
  bool get starting => _starting;

  /// Russian source text of the last failure (start, permission retry); the UI offers a retry.
  String? get error => _error;

  /// The last known permissions; null before the first check.
  ws.PermissionState? get permissions => _permissions;

  /// Lock-screen controls are hidden: notifications are not allowed.
  bool get notificationsBlocked => _permissions != null && _permissions!.notifications != ws.PermissionStatus.granted;

  /// The walk direction chosen before the start (a running walk keeps its own).
  WalkDirection get direction => state.active ? state.direction : _direction;

  /// Read from the settings each time: the walk intro changes it there before the start. A walk
  /// opened at a chosen stop always goes forward from it.
  WalkDirection get _direction =>
      link.fromStop == null && settings.reversed(_view.document.id) ? WalkDirection.reverse : WalkDirection.forward;

  bool get ownsService => identical(hub.owner, this);

  /// A saved place to continue from (not for a walk opened at a chosen stop).
  bool get resumable => link.fromStop == null && session.savedCheckpoint(_direction) != null;

  int get resumeIndex => link.fromStop == null ? session.savedChapterIndex(_direction) : -1;

  /// The walk view's chapter of a stop: its story with sources and facts.
  WalkChapter? chapterView(String? id) {
    if (id == null) return null;
    final index = _view.document.stops.indexWhere((stop) => stop.id == id);
    return index < 0 || index >= _view.chapters.length ? null : _view.chapters[index];
  }

  WalkStop? stopView(String? id) => _view.document.stops.where((stop) => stop.id == id).firstOrNull;

  // ---- Diagnostics (debug builds only) ----

  bool get diagnosticsVisible => kDebugMode && _diagnostics;
  bool get replayRunning => _replay.running;

  void toggleDiagnostics() {
    if (!kDebugMode) return;
    _diagnostics = !_diagnostics;
    notifyListeners();
  }

  /// Replaces GPS with a recorded track; native fixes are ignored until [stopReplay].
  void startReplay(ReplayMode mode, {double speed = 1}) {
    if (!kDebugMode || !state.active) return;
    final path = route.walk?.path.coordinates ?? const [];
    if (_replay.start(mode, path, speed: speed)) session.onPositionStatus(PositionStatus.starting);
    notifyListeners();
  }

  void stopReplay() {
    _replay.stop();
    notifyListeners();
  }

  // ---- Permissions ----

  Future<ws.PermissionState?> checkPermissions() async {
    try {
      _permissions = await hub.host.permissionState();
    } on Object catch (error) {
      debugPrint('permission state failed: ${error.runtimeType}');
    }
    _notify();
    return _permissions;
  }

  /// Asks for fine location, then notifications (Android 13+). Must run from a tap.
  Future<ws.PermissionState?> requestPermissions() async {
    try {
      _permissions = await hub.host.requestPermissions();
    } on Object catch (error) {
      debugPrint('permission request failed: ${error.runtimeType}');
      return checkPermissions();
    }
    _notify();
    return _permissions;
  }

  Future<void> openAppSettings() async {
    try {
      await hub.host.openAppSettings();
    } on Object catch (error) {
      debugPrint('app settings failed: ${error.runtimeType}');
    }
  }

  /// «Проверить снова» in the position help (a tap): asks again where Android still can, and
  /// starts tracking in the running session once location is allowed.
  Future<void> retryPosition() async {
    if (!state.active) return;
    var permissions = await checkPermissions();
    if (permissions != null && permissions.location == ws.PermissionStatus.denied) {
      permissions = await requestPermissions();
    } else if (permissions != null && permissions.location == ws.PermissionStatus.permanentlyDenied) {
      await openAppSettings();
      return;
    }
    if (permissions?.location == ws.PermissionStatus.granted) await _restartTracking();
  }

  Future<void> _restartTracking() async {
    if (!state.active || !ownsService) return;
    try {
      // While a session runs, startSession reconfigures it and starts location updates.
      await hub.acquire(this, _config());
      _error = null;
      if (state.positionDenied) session.onPositionStatus(PositionStatus.starting);
    } on Object catch (error) {
      _error = walkServiceMessage(error);
    }
    _notify();
  }

  // ---- Walk lifecycle ----

  void setDirection(WalkDirection direction) {
    if (state.active || link.fromStop != null || direction == _direction) return;
    unawaited(_guard(settings.setReversed(_view.document.id, direction == WalkDirection.reverse).then((_) => _notify())));
  }

  /// «Начать прогулку» (a tap): brings the walk service to the foreground, then starts the walk
  /// at [index], at the link's stop, or at the checkpoint when [resume]. Without location
  /// access the walk runs with the «нет доступа» status and manual switching.
  Future<bool> start({int? index, bool resume = true, required bool locationGranted}) async {
    if (state.active || _starting || _disposed) return false;
    _starting = true;
    _error = null;
    notifyListeners();
    try {
      await hub.acquire(this, _config());
    } on Object catch (error) {
      _starting = false;
      _error = walkServiceMessage(error);
      _notify();
      return false;
    }
    _starting = false;
    if (_disposed || !ownsService) {
      // The screen closed or another session took over while the service was starting.
      if (ownsService) await hub.release(this);
      return false;
    }
    bool started;
    try {
      started = session.start(
        resume: resume,
        index: index,
        fromStop: index == null ? link.fromStop : null,
        direction: _direction,
      );
    } on ArgumentError {
      started = false;
    }
    if (!started) {
      await hub.release(this);
      _error = WalkServiceMessages.generic;
      _notify();
      return false;
    }
    session.onPositionStatus(locationGranted ? PositionStatus.starting : PositionStatus.permissionDenied);
    _onCard(session.card);
    return true;
  }

  /// Ends the walk: [completed] clears the resume point, otherwise it is saved.
  void stop({bool completed = false}) {
    _replay.stop();
    session.stop(completed: completed);
  }

  /// The UI language changed (the language switch asked first): the running walk ends with its
  /// resume point saved, so the walk screen can reload the view in [next] and continue from it.
  void localeChanged(AppLocale next) {
    if (next != locale && state.active) stop();
  }

  /// A walk view of the same walk changed (a stop joined it): the walker keeps their stop.
  void updateView(WalkView view, Map<String, Uri> localAudio) {
    _localAudio = localAudio;
    if (identical(view, _view)) return;
    _view = view;
    session.updateRoute(walkViewToRoute(view));
  }

  // ---- Controls ----

  void toggle() => session.toggle();
  void next() => session.next();
  void previous() => session.previous();
  void selectChapter(int index) => session.selectChapter(index);
  void seekTo(double seconds) => session.seekTo(seconds);
  void seekBy(double seconds) => session.seekBy(seconds);

  void setAdvanceMode(AdvanceMode mode) {
    session.setAdvanceMode(mode);
    unawaited(_guard(settings.setAdvanceMode(prefs.AdvanceMode.values.byName(mode.name))));
  }

  void setRate(double rate) {
    session.setRate(rate);
    unawaited(_guard(settings.setRate(rate)));
  }

  /// The next rate after the current one, wrapping (the site's speed button).
  void cycleRate() {
    final index = playbackRates.indexOf(state.rate);
    setRate(playbackRates[(index + 1) % playbackRates.length]);
  }

  // ---- SessionOwner (native → engine) ----

  @override
  void onFix(ws.Fix fix) {
    if (_replay.running) return;
    _applyFix(PositionFix(lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, timestampMs: fix.timestampMs.toDouble()));
  }

  @override
  void onLocationStatus(ws.LocationStatus status, String? code) {
    if (_replay.running) return;
    session.onPositionStatus(positionStatusOf(status));
  }

  @override
  void onPlayer(ws.PlayerState state) {
    if (state.state == ws.PlaybackState.ended) {
      final track = state.trackId;
      if (track == null || track == _endedTrack) return;
      _endedTrack = track;
      session.onTrackEnded(track);
      return;
    }
    final snapshot = playerSnapshotOf(state);
    if (snapshot != null) session.onPlayerState(snapshot);
  }

  /// Lock screen, notification, headset: the same meaning as on the site's media session.
  @override
  void onMediaCommand(ws.MediaCommand command) {
    if (!state.active) return;
    final ms = command.ms;
    switch (command.kind) {
      case ws.MediaCommandKind.play:
        session.play();
      case ws.MediaCommandKind.pause:
        session.pause();
      case ws.MediaCommandKind.next:
        session.skipToNext();
      case ws.MediaCommandKind.previous:
        session.previous();
      case ws.MediaCommandKind.seekBy:
        if (ms != null) session.seekBy(ms / 1000);
      case ws.MediaCommandKind.seekTo:
        if (ms != null) session.seekTo(ms / 1000);
      case ws.MediaCommandKind.stop:
        stop();
    }
  }

  @override
  void onSessionStopped() => _endWithoutService();

  @override
  void onRevoked() => _endWithoutService();

  void _endWithoutService() {
    _replay.stop();
    // The hub no longer counts this walk as the owner: the engine's stop command finds no session.
    session.stop();
  }

  void _onReplayFix(PositionFix fix) => _applyFix(fix);

  void _applyFix(PositionFix fix) {
    // A fix means location works: the replay source never reports a status, and a signal that
    // recovers after `unavailable` must not keep «Нет сигнала» until the next status event.
    if (state.positionStatus != PositionStatus.active) session.onPositionStatus(PositionStatus.active);
    session.onFix(fix);
  }

  // ---- Engine → native ----

  void _onCommand(PlayerCommand command) {
    switch (command) {
      case PlayTrack(:final track, :final startPositionSec, :final rate):
        _endedTrack = null;
        final ws.Track native;
        try {
          native = _track(track, startPositionSec, rate);
        } on FormatException {
          _playFailed(track.url);
          return;
        }
        _host((host) => host.play(native), onError: (_) => _playFailed(track.url));
      case PausePlayback():
        _host((host) => host.pause());
      case ResumePlayback():
        final url = state.audioUrl;
        _host((host) => host.resume(), onError: (_) => _playFailed(url));
      case SeekTo(:final positionSec):
        _host((host) => host.seekTo(toMs(positionSec)));
      case SetRate(:final rate):
        _host((host) => host.setRate(rate));
      case PrefetchAudio(:final url):
        final chapter = chapters.where((item) => item.audio?.url == url).firstOrNull;
        if ((chapter != null && _localAudio.containsKey(chapter.id)) || _localAudio.containsKey(url)) return;
        _host((host) => host.prefetch(audioUri(url, origin: origin)));
      case StopPlayback(:final endOfWalk):
        if (endOfWalk) {
          if (ownsService) {
            _calls = _calls.then((_) => hub.release(this));
          }
        } else {
          _host((host) => host.pause());
        }
    }
  }

  ws.Track _track(PlayerTrack track, double startSec, double rate) => ws.Track(
        // The engine follows tracks by their site URL; the player echoes the id in its reports.
        id: track.url,
        uri: audioUri(track.url, origin: origin, chapterId: track.chapterId, local: _localAudio),
        title: track.title,
        subtitle: translations.translate(locale, 'Часть {current} из {total} · {place}', {
          'current': track.chapterIndex + 1,
          'total': track.chapterCount,
          'place': track.place,
        }),
        album: track.walkTitle,
        startPositionMs: toMs(startSec),
        rate: rate,
        autoplay: true,
      );

  void _playFailed(String? url) {
    if (!state.active) return;
    session.onPlayerState(PlayerSnapshot(url: url, status: PlayerStatus.error, positionSec: state.positionSec));
  }

  void _onCard(CardState card) {
    if (!state.active) return;
    final native = serviceCard(card, _walkTitle);
    _host((host) => host.updateCard(native));
  }

  void _onState(WalkUiState state) {
    if (state.active != _wasActive) {
      _wasActive = state.active;
      onActiveChanged?.call(state.active);
    }
    _notify();
  }

  /// Host calls run one after another in the order the engine issued them, and only while this
  /// walk owns the service; a failure never escapes into the engine's stream.
  void _host(Future<void> Function(ws.WalkServiceHostApi host) call, {void Function(Object error)? onError}) {
    _calls = _calls.then((_) async {
      if (!ownsService) return;
      try {
        await call(hub.host);
      } on Object catch (error) {
        debugPrint('walk service call failed: ${error.runtimeType}');
        onError?.call(error);
      }
    });
  }

  ws.SessionConfig _config() => ws.SessionConfig(
        kind: ws.SessionKind.walk,
        walkTitle: _walkTitle,
        texts: notificationTexts(translations, locale),
        tracking: true,
        locationIntervalMs: 1000,
        minDistanceM: 0,
        // Without fromStop: reopening from the card must not restart the walk at a stop.
        contentRoute: Uri(path: '/walk', queryParameters: link.query).toString(),
      );

  String get _walkTitle {
    final title = route.title.trim();
    return title.isEmpty ? translations.translate(locale, 'Ваш маршрут') : title;
  }

  void _onLifecycle(AppLifecycleState lifecycle) {
    switch (lifecycle) {
      case AppLifecycleState.paused || AppLifecycleState.hidden || AppLifecycleState.detached:
        session.persist();
      case AppLifecycleState.resumed:
        // Back from the phone settings: start tracking if location was allowed there.
        if (state.active && state.positionDenied) unawaited(_resumeTracking());
      case AppLifecycleState.inactive:
        break;
    }
  }

  Future<void> _resumeTracking() async {
    final permissions = await checkPermissions();
    if (permissions?.location == ws.PermissionStatus.granted) await _restartTracking();
  }

  Future<void> _guard(Future<void> operation) async {
    try {
      await operation;
    } on Object catch (error) {
      // Preferences that fail to save only lose a convenience, never the walk.
      debugPrint('walk preference was not saved: ${error.runtimeType}');
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    if (_disposed) return;
    // Leaving the walk screen ends the walk, as on the site; the resume point is saved.
    if (state.active) stop();
    _disposed = true;
    // The engine's state stream is asynchronous and its subscription ends here: the end of the
    // walk is reported now, or the router would keep asking before leaving a walk that is over.
    if (_wasActive) {
      _wasActive = false;
      onActiveChanged?.call(false);
    }
    _replay.stop();
    _lifecycle.dispose();
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(session.dispose());
    if (ownsService) unawaited(hub.release(this));
    super.dispose();
  }

  static AdvanceMode _engineMode(prefs.AdvanceMode mode) => AdvanceMode.values.byName(mode.name);

  static PlaybackLocale _playbackLocale(ContentLocale locale) => switch (locale) {
        ContentLocale.ru => PlaybackLocale.ru,
        ContentLocale.en => PlaybackLocale.en,
        ContentLocale.zh => PlaybackLocale.zh,
      };
}
