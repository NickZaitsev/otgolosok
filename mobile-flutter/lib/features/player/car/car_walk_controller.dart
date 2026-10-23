import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../../../core/i18n/translations.dart';
import '../../../core/settings/settings_store.dart';
import '../../../walk_engine/driving_plan.dart';
import '../../../walk_engine/walk_plan.dart';
import '../../../walk_engine/walk_route.dart';
import '../../../walk_engine/walk_view.dart';
import '../../walks/walk_link.dart';
import '../service_errors.dart';
import '../service_mapping.dart';
import '../walk_service_hub.dart';

/// The audio of the current car-walk story.
@immutable
class CarAudio {
  const CarAudio({this.loading = false, this.playing = false, this.position = 0, this.duration = 0, this.error});

  final bool loading;
  final bool playing;

  /// Seconds.
  final double position;
  final double duration;

  /// Russian source text of the failure.
  final String? error;
}

/// A car walk (site `DrivingExperience`): the driving-plan reducer moves on one explicit
/// handoff at a time; no GPS arrival starts a story. The story of a stop plays only while the
/// walker is out of the car (`visiting`), in a `listen` session of the walk service.
class CarWalkController extends ChangeNotifier implements SessionOwner {
  CarWalkController({
    required this.view,
    required this.link,
    required this.hub,
    required this.settings,
    required this.origin,
    required this.translations,
    required this.locale,
    this.localAudio = const {},
    this.reportLaunch,
    this.onActiveChanged,
  })  : car = view.document.route?.car,
        options = DrivingPlanOptions(finishRequired: view.document.mode == WalkMode.loop || view.document.destination != null) {
    chapters = {for (final chapter in getWalkChapters(walkViewToRoute(view), includePending: true)) chapter.id: chapter};
    final route = car;
    if (route != null) {
      _state = parseDrivingProgress(settings.readString(drivingProgressKey(view.document.id)), view.revision, route, options);
      _wasActive = active;
      if (_wasActive) scheduleMicrotask(() => onActiveChanged?.call(true));
    }
  }

  final WalkView view;
  final WalkLink link;
  final WalkServiceHub hub;
  final SettingsStore settings;
  final Uri origin;
  final Translations translations;
  final AppLocale locale;
  /// Saved recordings; a new offline copy replaces them for the next stories.
  Map<String, Uri> localAudio;
  final void Function()? reportLaunch;
  final void Function(bool active)? onActiveChanged;

  /// Null when the walk has no car route yet («В этой прогулке ещё нет маршрута»).
  final CarRoute? car;
  final DrivingPlanOptions options;
  late final Map<String, RouteChapter> chapters;

  DrivingPlanState _state = initialDrivingPlanState();
  CarAudio _audio = const CarAudio();
  String? _track;
  bool _wasActive = false;
  bool _disposed = false;
  Future<void> _calls = Future.value();

  @override
  SessionOwnerKind get ownerKind => SessionOwnerKind.car;

  DrivingPlanState get state => _state;
  CarAudio get audio => _audio;
  double get rate => settings.rate;
  bool get ownsService => identical(hub.owner, this);

  bool get active => _state is! DrivingOverview && _state is! DrivingComplete;

  ParkingVisit? get visit {
    final route = car;
    return route == null ? null : currentDrivingVisit(_state, route);
  }

  /// The story shown while visiting; null between parkings or for a stop without a chapter.
  RouteChapter? get chapter {
    final route = car;
    final id = route == null ? null : currentDrivingStopId(_state, route);
    return id == null ? null : chapters[id];
  }

  /// The recording of the current story; only while visiting.
  String? get storySource => _state is DrivingVisiting ? chapter?.audio?.url : null;

  /// One explicit handoff (a tap): the playing story stops first, the progress is saved.
  void transition(DrivingPlanAction action) {
    final route = car;
    if (route == null) return;
    final next = advanceDrivingPlan(_state, action, route, options);
    // Leaving a story stops its audio, also when two stories share one recording.
    _stopAudio();
    if (action == DrivingPlanAction.start) reportLaunch?.call();
    _state = next;
    unawaited(_save());
    final nowActive = active;
    if (nowActive != _wasActive) {
      _wasActive = nowActive;
      onActiveChanged?.call(nowActive);
    }
    _notify();
  }

  Future<void> _save() async {
    final key = drivingProgressKey(view.document.id);
    try {
      if (active) {
        await settings.writeString(key, serializeDrivingProgress(view.revision, _state));
      } else {
        await settings.remove(key);
      }
    } on Object catch (error) {
      // The trip stays usable when the progress cannot be saved.
      debugPrint('driving progress was not saved: ${error.runtimeType}');
    }
  }

  /// Play/pause of the story (a tap: the first play brings the service to the foreground).
  /// The UI asks before this replaces a walk or a place story holding the service.
  Future<void> toggle() async {
    final source = storySource;
    final current = chapter;
    if (source == null || current == null || !drivingAudioAllowed(_state)) return;
    if (ownsService && _track == source) {
      if (_audio.playing || _audio.loading) {
        _host((host) => host.pause());
      } else {
        _host((host) => host.resume(), onError: _failed);
      }
      return;
    }
    final String uri;
    try {
      uri = audioUri(source, origin: origin, chapterId: current.id, local: localAudio);
    } on FormatException {
      _failed(null);
      return;
    }
    _track = source;
    _audio = const CarAudio(loading: true);
    _notify();
    try {
      await hub.acquire(this, _config());
    } on Object catch (error) {
      _track = null;
      _audio = CarAudio(error: walkServiceMessage(error, fallback: WalkServiceMessages.playback));
      _notify();
      return;
    }
    if (_track != source || !ownsService) return;
    _host(
      (host) => host.play(ws.Track(
        id: source,
        uri: uri,
        title: current.title,
        subtitle: current.step.place,
        album: _walkTitle,
        startPositionMs: 0,
        rate: settings.rate,
        autoplay: true,
      )),
      onError: _failed,
    );
  }

  void seekTo(double seconds) {
    if (!ownsService || _track == null) return;
    _host((host) => host.seekTo(toMs(seconds)));
  }

  Future<void> cycleRate() async {
    final next = playbackRates[(playbackRates.indexOf(settings.rate) + 1) % playbackRates.length];
    try {
      await settings.setRate(next);
    } on Object catch (error) {
      debugPrint('car rate was not saved: ${error.runtimeType}');
    }
    _notify();
    if (ownsService) _host((host) => host.setRate(next));
  }

  void _stopAudio() {
    _track = null;
    _audio = const CarAudio();
    if (ownsService) _calls = _calls.then((_) => hub.release(this));
  }

  void _failed(Object? error) {
    _audio = CarAudio(position: _audio.position, duration: _audio.duration, error: WalkServiceMessages.playback);
    _notify();
  }

  void _host(Future<void> Function(ws.WalkServiceHostApi host) call, {void Function(Object error)? onError}) {
    _calls = _calls.then((_) async {
      if (!ownsService) return;
      try {
        await call(hub.host);
      } on Object catch (error) {
        debugPrint('car walk service call failed: ${error.runtimeType}');
        onError?.call(error);
      }
    });
  }

  ws.SessionConfig _config() => ws.SessionConfig(
        kind: ws.SessionKind.listen,
        walkTitle: _walkTitle,
        texts: notificationTexts(translations, locale),
        tracking: false,
        locationIntervalMs: 1000,
        minDistanceM: 0,
        contentRoute: Uri(path: '/walk', queryParameters: link.query).toString(),
      );

  String get _walkTitle {
    final title = view.document.title.trim();
    return title.isEmpty ? translations.translate(locale, 'Ваш маршрут') : title;
  }

  // ---- SessionOwner ----

  @override
  void onFix(ws.Fix fix) {}

  @override
  void onLocationStatus(ws.LocationStatus status, String? code) {}

  @override
  void onPlayer(ws.PlayerState player) {
    final track = _track;
    if (track == null || player.trackId != track) return;
    final duration = player.durationMs > 0 ? player.durationMs / 1000 : _audio.duration;
    final position = player.positionMs > 0 ? player.positionMs / 1000 : 0.0;
    switch (player.state) {
      case ws.PlaybackState.ended:
        _audio = CarAudio(position: duration, duration: duration);
        _track = null;
        unawaited(hub.release(this));
      case ws.PlaybackState.error:
        _audio = CarAudio(position: position, duration: duration, error: WalkServiceMessages.playback);
      case ws.PlaybackState.idle:
        return;
      case ws.PlaybackState.buffering:
        _audio = CarAudio(loading: true, position: position, duration: duration);
      case ws.PlaybackState.playing:
        _audio = CarAudio(playing: true, position: position, duration: duration);
      case ws.PlaybackState.paused:
        _audio = CarAudio(position: position, duration: duration);
    }
    _notify();
  }

  @override
  void onMediaCommand(ws.MediaCommand command) {
    final ms = command.ms;
    switch (command.kind) {
      case ws.MediaCommandKind.play:
        if (!_audio.playing) _host((host) => host.resume(), onError: _failed);
      case ws.MediaCommandKind.pause:
        _host((host) => host.pause());
      case ws.MediaCommandKind.stop:
        _stopAudio();
        _notify();
      case ws.MediaCommandKind.seekBy:
        if (ms != null) _host((host) => host.seekBy(ms));
      case ws.MediaCommandKind.seekTo:
        if (ms != null) _host((host) => host.seekTo(ms));
      case ws.MediaCommandKind.next || ws.MediaCommandKind.previous:
        // Stories change with the explicit buttons on the screen only.
        break;
    }
  }

  @override
  void onSessionStopped() => _reset();

  @override
  void onRevoked() => _reset();

  void _reset() {
    _track = null;
    _audio = const CarAudio();
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (ownsService) unawaited(hub.release(this));
    // Leaving the screen keeps the saved trip: the router no longer guards it.
    if (_wasActive) {
      _wasActive = false;
      onActiveChanged?.call(false);
    }
    super.dispose();
  }
}
