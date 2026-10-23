import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/settings/settings_store.dart';
import '../places/story_audio.dart';
import 'audio_controls.dart';
import 'providers.dart';
import 'service_errors.dart';
import 'service_mapping.dart';
import 'takeover_dialog.dart';
import 'walk_service_hub.dart';

/// A place story played by the walk service in a `listen` session: no location tracking, the
/// media card on the lock screen. Implements the place card's [StoryAudioController], so the
/// card can be bound to it (`storyAudioControllerProvider`).
class StoryListenController extends ChangeNotifier implements StoryAudioController, SessionOwner {
  StoryListenController({required this.hub, required this.settings, required this.translations, required this.locale});

  final WalkServiceHub hub;
  final SettingsStore settings;
  final Translations translations;
  final AppLocale Function() locale;

  StoryAudioState _state = const StoryAudioState();
  StoryAudioRequest? _request;
  bool _disposed = false;

  /// Shown when [play] is called without permission to stop a running walk.
  static const walkRunning = 'Сейчас идёт прогулка. Остановите её, чтобы послушать историю.';

  @override
  SessionOwnerKind get ownerKind => SessionOwnerKind.story;

  @override
  StoryAudioState get state => _state;

  double get rate => settings.rate;

  bool get ownsService => identical(hub.owner, this);

  /// Starts [request] from the beginning. A walk holding the service is stopped only with
  /// [takeOver] (the UI asked the user, see [confirmTakeover]); otherwise the story fails with
  /// [walkRunning]. Must run from a tap: the service starts in the foreground.
  @override
  Future<void> play(StoryAudioRequest request, {bool takeOver = false}) async {
    final other = hub.owner;
    if (other != null && !identical(other, this) && other.ownerKind != SessionOwnerKind.story && !takeOver) {
      _set(StoryAudioState(placeId: request.placeId, phase: StoryAudioPhase.failed, error: walkRunning));
      return;
    }
    _request = request;
    final duration = request.durationSec;
    _set(StoryAudioState(
      placeId: request.placeId,
      phase: StoryAudioPhase.preparing,
      duration: duration == null || !duration.isFinite || duration <= 0 ? null : Duration(milliseconds: (duration * 1000).round()),
    ));
    try {
      await hub.acquire(this, _config(request));
      if (!identical(_request, request) || !ownsService) return;
      await hub.host.play(ws.Track(
        id: request.url.toString(),
        uri: request.url.toString(),
        title: request.title,
        subtitle: request.subtitle,
        album: translations.translate(locale(), 'Отголосок'),
        artworkUri: request.artworkUrl?.toString(),
        startPositionMs: 0,
        rate: settings.rate,
        autoplay: true,
      ));
    } on Object catch (error) {
      debugPrint('story start failed: ${error.runtimeType}');
      if (!identical(_request, request)) return;
      _set(StoryAudioState(
        placeId: request.placeId,
        phase: StoryAudioPhase.failed,
        error: WalkServiceMessages.storyGeneric,
      ));
      if (ownsService) await hub.release(this);
    }
  }

  @override
  Future<void> pause() => _call((host) => host.pause());

  @override
  Future<void> resume() => _call((host) => host.resume());

  Future<void> seekTo(Duration position) => _call((host) => host.seekTo(position.inMilliseconds < 0 ? 0 : position.inMilliseconds));

  /// The listener's walk rate (the site keeps one rate for stories and walks).
  Future<void> cycleRate() async {
    final rates = playbackRates;
    final next = rates[(rates.indexOf(settings.rate) + 1) % rates.length];
    try {
      await settings.setRate(next);
    } on Object catch (error) {
      debugPrint('story rate was not saved: ${error.runtimeType}');
    }
    notifyListeners();
    await _call((host) => host.setRate(next));
  }

  /// Stops the story and the service (the notification goes away).
  Future<void> stop() async {
    _request = null;
    _set(const StoryAudioState());
    await hub.release(this);
  }

  Future<void> _call(Future<void> Function(ws.WalkServiceHostApi host) call) async {
    if (!ownsService) return;
    try {
      await call(hub.host);
    } on Object catch (error) {
      debugPrint('story call failed: ${error.runtimeType}');
      final request = _request;
      if (request == null) return;
      _set(StoryAudioState(
        placeId: request.placeId,
        phase: StoryAudioPhase.failed,
        position: _state.position,
        duration: _state.duration,
        error: WalkServiceMessages.storyGeneric,
      ));
    }
  }

  ws.SessionConfig _config(StoryAudioRequest request) => ws.SessionConfig(
        kind: ws.SessionKind.listen,
        walkTitle: request.title,
        texts: notificationTexts(translations, locale()),
        tracking: false,
        locationIntervalMs: 1000,
        minDistanceM: 0,
        contentRoute: Uri(path: '/', queryParameters: {'place': request.placeId}).toString(),
      );

  // ---- SessionOwner ----

  @override
  void onFix(ws.Fix fix) {}

  @override
  void onLocationStatus(ws.LocationStatus status, String? code) {}

  @override
  void onPlayer(ws.PlayerState player) {
    final request = _request;
    if (request == null || player.trackId != request.url.toString()) return;
    final duration = player.durationMs > 0 ? Duration(milliseconds: player.durationMs) : _state.duration;
    final position = Duration(milliseconds: player.positionMs < 0 ? 0 : player.positionMs);
    switch (player.state) {
      case ws.PlaybackState.ended:
        // The story is over: the service and its card are not kept for nothing.
        _request = null;
        _set(StoryAudioState(placeId: request.placeId, duration: duration));
        unawaited(hub.release(this));
      case ws.PlaybackState.error:
        _set(StoryAudioState(
          placeId: request.placeId,
          phase: StoryAudioPhase.failed,
          position: position,
          duration: duration,
          error: WalkServiceMessages.storyGeneric,
        ));
      case ws.PlaybackState.idle:
        return;
      case ws.PlaybackState.buffering || ws.PlaybackState.playing || ws.PlaybackState.paused:
        _set(StoryAudioState(
          placeId: request.placeId,
          phase: switch (player.state) {
            ws.PlaybackState.buffering => StoryAudioPhase.preparing,
            ws.PlaybackState.playing => StoryAudioPhase.playing,
            _ => StoryAudioPhase.paused,
          },
          position: position,
          duration: duration,
        ));
    }
  }

  @override
  void onMediaCommand(ws.MediaCommand command) {
    final ms = command.ms;
    switch (command.kind) {
      case ws.MediaCommandKind.play:
        unawaited(resume());
      case ws.MediaCommandKind.pause:
        unawaited(pause());
      case ws.MediaCommandKind.stop:
        unawaited(stop());
      case ws.MediaCommandKind.seekBy:
        if (ms != null) unawaited(_call((host) => host.seekBy(ms)));
      case ws.MediaCommandKind.seekTo:
        if (ms != null) unawaited(_call((host) => host.seekTo(ms)));
      case ws.MediaCommandKind.next || ws.MediaCommandKind.previous:
        // A single story has no other part.
        break;
    }
  }

  @override
  void onSessionStopped() => _reset();

  @override
  void onRevoked() => _reset();

  void _reset() {
    _request = null;
    _set(const StoryAudioState());
  }

  void _set(StoryAudioState state) {
    _state = state;
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Play/pause, progress and speed of one place story, played through the walk service.
/// Starting it while a walk runs asks first; one recording plays at a time app-wide.
class StoryListenButton extends ConsumerWidget {
  const StoryListenButton({
    super.key,
    required this.id,
    required this.audio,
    required this.title,
    this.subtitle,
    this.artwork,
    this.durationSec,
  });

  /// The place id (`osm:node:…`); the card on the lock screen opens it.
  final String id;

  /// Absolute `https://` (or offline `file://`) URL of the recording.
  final Uri audio;
  final String title;
  final String? subtitle;
  final Uri? artwork;

  /// Known duration before the file opens; the player reports the real one.
  final double? durationSec;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(storyListenControllerProvider);
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final state = controller.state;
        final mine = state.placeId == id;
        final phase = mine ? state.phase : StoryAudioPhase.idle;
        final playing = phase == StoryAudioPhase.playing || phase == StoryAudioPhase.preparing;
        final label = switch (phase) {
          StoryAudioPhase.idle => context.t('Слушать историю'),
          StoryAudioPhase.preparing => context.t('Загружаем запись'),
          StoryAudioPhase.playing => context.t('Пауза'),
          StoryAudioPhase.paused => context.t('Продолжить'),
          StoryAudioPhase.failed => context.t('Повторить запуск звука'),
        };
        final duration = (mine ? state.duration : null) ?? _known;
        final position = mine ? state.position : Duration.zero;
        final active = mine && (phase == StoryAudioPhase.playing || phase == StoryAudioPhase.paused);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            AudioControls(
              position: position.inMilliseconds / 1000,
              duration: (duration?.inMilliseconds ?? 0) / 1000,
              canSeek: active && duration != null,
              playing: playing,
              label: label,
              rate: controller.rate,
              onToggle: () => unawaited(_toggle(context, ref, phase)),
              onSeek: (seconds) => unawaited(controller.seekTo(Duration(milliseconds: (seconds * 1000).round()))),
              onRate: active ? () => unawaited(controller.cycleRate()) : null,
            ),
            if (mine && phase == StoryAudioPhase.failed && state.error != null)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
                child: Semantics(
                  liveRegion: true,
                  child: Text(context.t(state.error!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              ),
          ],
        );
      },
    );
  }

  Duration? get _known {
    final seconds = durationSec;
    return seconds == null || !seconds.isFinite || seconds <= 0 ? null : Duration(milliseconds: (seconds * 1000).round());
  }

  Future<void> _toggle(BuildContext context, WidgetRef ref, StoryAudioPhase phase) async {
    final controller = ref.read(storyListenControllerProvider);
    switch (phase) {
      case StoryAudioPhase.playing:
        await controller.pause();
      case StoryAudioPhase.paused:
        await controller.resume();
      case StoryAudioPhase.preparing:
        return;
      case StoryAudioPhase.idle || StoryAudioPhase.failed:
        final hub = ref.read(walkServiceHubProvider);
        final other = hub.owner;
        var takeOver = false;
        if (other != null && !identical(other, controller) && other.ownerKind != SessionOwnerKind.story) {
          if (!await confirmTakeover(context, current: other.ownerKind)) return;
          takeOver = true;
        }
        await controller.play(
          StoryAudioRequest(
            placeId: id,
            url: audio,
            title: title,
            subtitle: subtitle ?? '',
            artworkUrl: artwork,
            durationSec: durationSec,
          ),
          takeOver: takeOver,
        );
    }
  }
}
