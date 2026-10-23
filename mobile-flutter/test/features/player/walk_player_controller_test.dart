import 'dart:convert';

import 'package:flutter/widgets.dart' hide Route;
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/player/service_errors.dart';
import 'package:otgolosok/features/player/story_listen.dart';
import 'package:otgolosok/features/player/walk_drawers.dart';
import 'package:otgolosok/features/player/walk_player_controller.dart';
import 'package:otgolosok/features/player/walk_service_hub.dart';
import 'package:otgolosok/features/places/story_audio.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/walk_engine/checkpoint.dart';
import 'package:otgolosok/walk_engine/walk_direction.dart';
import 'package:otgolosok/walk_engine/walk_session.dart';
import 'package:otgolosok/walk_engine/walk_settings.dart' as engine;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../auth/harness.dart' show loadTranslations;
import 'fake_host.dart';

final origin = Uri.parse('https://otgolosok.online');
final translations = loadTranslations();

class _Setup {
  _Setup(this.settings);

  final host = FakeHost();
  late final hub = WalkServiceHub(host);
  final SettingsStore settings;
  final checkpoints = InMemoryCheckpointStore();
  final active = <bool>[];
  var launches = 0;

  WalkPlayerController walk({WalkLink link = const CatalogWalkLink('arbat'), Map<String, Uri> localAudio = const {}}) {
    final controller = WalkPlayerController(
      view: walkView(),
      link: link,
      hub: hub,
      settings: settings,
      origin: origin,
      translations: translations,
      locale: AppLocale.ru,
      localAudio: localAudio,
      reportLaunch: () => launches += 1,
      onActiveChanged: active.add,
      checkpoints: checkpoints,
    );
    addTearDown(controller.dispose);
    return controller;
  }

  StoryListenController story() {
    final controller = StoryListenController(hub: hub, settings: settings, translations: translations, locale: () => AppLocale.ru);
    addTearDown(controller.dispose);
    return controller;
  }

  String get checkpointKey => walkCheckpointKey('arbat-test', PlaybackLocale.ru, WalkDirection.forward);
}

Future<_Setup> _setup({Map<String, Object> prefs = const {}}) async {
  SharedPreferences.setMockInitialValues(prefs);
  return _Setup(SettingsStore(await SharedPreferences.getInstance()));
}

/// The saved resume point: its stop and position.
({String? chapterId, double? positionSec})? _saved(_Setup setup) {
  final raw = setup.checkpoints.values[setup.checkpointKey];
  if (raw == null) return null;
  final json = jsonDecode(raw) as Map<String, Object?>;
  return (chapterId: json['chapterId'] as String?, positionSec: (json['positionSec'] as num?)?.toDouble());
}

ws.PlayerState _player(String url, ws.PlaybackState state, {int positionMs = 0, int durationMs = 60000}) =>
    ws.PlayerState(trackId: url, state: state, positionMs: positionMs, durationMs: durationMs);

ws.MediaCommand _media(ws.MediaCommandKind kind, [int? ms]) => ws.MediaCommand(kind: kind, ms: ms);

/// Starts the walk and plays the first story (pressing play on the way means «I am there»).
Future<WalkPlayerController> _playing(_Setup setup, {Map<String, Uri> localAudio = const {}}) async {
  final walk = setup.walk(localAudio: localAudio);
  expect(await walk.start(locationGranted: true), isTrue);
  walk.toggle();
  await pumpEventQueue();
  return walk;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('engine commands reach the walk service', () {
    test('the start configures a tracked walk session that reopens the walk', () async {
      final setup = await _setup();
      final walk = setup.walk();
      expect(await walk.start(locationGranted: true), isTrue);
      final config = setup.host.sessions.single;
      expect(config.kind, ws.SessionKind.walk);
      expect(config.tracking, isTrue);
      expect(config.walkTitle, 'Арбат');
      expect(config.contentRoute, '/walk?catalog=arbat');
      // Templates keep their placeholders: the service fills them.
      expect(config.texts.partOf, 'Часть {current} из {total}');
      expect(setup.launches, 1);
      await pumpEventQueue();
      expect(setup.active, [true]);
      expect(setup.host.cards.last.chapterTitle, 'Дом 1');
    });

    test('a walk opened at a stop reopens without it', () async {
      final setup = await _setup();
      final walk = setup.walk(link: const CatalogWalkLink('arbat', fromStop: 'b-stop'));
      await walk.start(locationGranted: true);
      expect(setup.host.sessions.single.contentRoute, '/walk?catalog=arbat');
      expect(walk.state.chapterIndex, 1);
    });

    test('play sends the track by its site URL, resolved on the origin', () async {
      final setup = await _setup();
      await _playing(setup);
      final track = setup.host.tracks.single;
      expect(track.id, audioOf('a'));
      expect(track.uri, 'https://otgolosok.online${audioOf('a')}');
      expect(track.title, 'Дом 1');
      expect(track.subtitle, 'Часть 1 из 3 · Москва, a-stop');
      expect(track.album, 'Арбат');
      expect(track.rate, 1);
      expect(track.autoplay, isTrue);
    });

    test('a saved recording is played from the device', () async {
      final setup = await _setup();
      await _playing(setup, localAudio: {audioOf('a'): Uri.parse('file:///data/a.mp3')});
      expect(setup.host.tracks.single.uri, 'file:///data/a.mp3');
      expect(setup.host.tracks.single.id, audioOf('a'));
    });

    test('pause, seek and rate become host calls in order', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 5000));
      walk.toggle();
      walk.setRate(1.25);
      await pumpEventQueue();
      expect(setup.host.calls, containsAllInOrder(['play', 'pause', 'setRate 1.25']));
      expect(setup.settings.rate, 1.25);
    });
  });

  group('lock-screen commands', () {
    test('next and previous switch stops, stop ends the walk with its place saved', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 20000));
      walk.onMediaCommand(_media(ws.MediaCommandKind.next));
      expect(walk.state.chapterIndex, 1);
      walk.onMediaCommand(_media(ws.MediaCommandKind.previous));
      expect(walk.state.chapterIndex, 0);
      walk.onMediaCommand(_media(ws.MediaCommandKind.stop));
      await pumpEventQueue();
      expect(walk.state.active, isFalse);
      expect(setup.host.count('stopSession'), 1);
      expect(setup.hub.owner, isNull);
      expect(setup.checkpoints.values[setup.checkpointKey], isNotNull);
      expect(setup.active, [true, false]);
    });

    test('seek commands carry milliseconds into the engine', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 20000));
      walk.onMediaCommand(_media(ws.MediaCommandKind.seekBy, -15000));
      walk.onMediaCommand(_media(ws.MediaCommandKind.seekTo, 40000));
      await pumpEventQueue();
      expect(setup.host.calls, containsAllInOrder(['seekTo 5000', 'seekTo 40000']));
    });

    test('commands after the walk ended are ignored', () async {
      final setup = await _setup();
      final walk = setup.walk();
      walk.onMediaCommand(_media(ws.MediaCommandKind.play));
      await pumpEventQueue();
      expect(setup.host.calls, isEmpty);
    });
  });

  test('without location access the walk runs in manual mode with the site status', () async {
    final setup = await _setup();
    final walk = setup.walk();
    expect(await walk.start(locationGranted: false), isTrue);
    expect(walk.state.active, isTrue);
    expect(walk.state.positionDenied, isTrue);
    expect(walk.state.advance, engine.AdvanceMode.place);
    expect(walk.state.effectiveAdvance, engine.AdvanceMode.manual);
    expect(walk.state.statusText.key, statusDenied);
    // The service still runs: the story plays by the button.
    walk.toggle();
    await pumpEventQueue();
    expect(setup.host.tracks, hasLength(1));
  });

  test('a location that fails later also falls back to manual switching', () async {
    final setup = await _setup();
    final walk = setup.walk();
    await walk.start(locationGranted: true);
    walk.onLocationStatus(ws.LocationStatus.unavailable, 'location_unavailable');
    expect(walk.state.effectiveAdvance, engine.AdvanceMode.manual);
    expect(walk.state.statusText.key, statusNoSignal);
    // A fix means it works again: a source that never reports `active` must not stay «Нет сигнала».
    walk.onFix(ws.Fix(lat: 55.7515, lon: 37.5925, accuracyM: 8, timestampMs: 1000, provider: 'fused'));
    expect(walk.state.positionStatus, PositionStatus.active);
    expect(walk.state.effectiveAdvance, engine.AdvanceMode.place);
  });

  group('failures', () {
    test('a refused start explains itself and the retry starts the walk', () async {
      final setup = await _setup();
      setup.host.refusals['startSession'] = ['fgs_not_allowed'];
      final walk = setup.walk();
      expect(await walk.start(locationGranted: true), isFalse);
      expect(walk.error, WalkServiceMessages.startRefused);
      expect(walk.state.active, isFalse);
      expect(setup.hub.owner, isNull);
      expect(await walk.start(locationGranted: true), isTrue);
      expect(walk.error, isNull);
      expect(walk.state.active, isTrue);
    });

    test('a player error offers «Повторить запуск звука», and the retry plays again', () async {
      final setup = await _setup();
      setup.host.refusals['play'] = ['player_error'];
      final walk = await _playing(setup);
      expect(walk.state.audioStatus, WalkAudioStatus.error);
      expect(walkAudioLabel(walk.state), 'Повторить запуск звука');
      walk.toggle();
      await pumpEventQueue();
      expect(setup.host.count('play'), 2);
      expect(walk.state.audioStatus, isNot(WalkAudioStatus.error));
    });

    test('an error reported by the player is shown the same way', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.error));
      expect(walk.state.audioStatus, WalkAudioStatus.error);
      expect(walk.state.active, isTrue);
    });
  });

  test('going to the background saves the resume point', () async {
    final setup = await _setup();
    final walk = await _playing(setup);
    walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 30000));
    setup.checkpoints.values.clear();
    TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await pumpEventQueue();
    final saved = _saved(setup);
    expect(saved?.chapterId, 'a-stop');
    expect(saved?.positionSec, closeTo(30, 0.01));
    TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    expect(walk.state.active, isTrue);
  });

  test('a service the system stopped ends the walk without calling it again', () async {
    final setup = await _setup();
    final walk = await _playing(setup);
    walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 12000));
    setup.hub.onSessionStopped();
    await pumpEventQueue();
    expect(walk.state.active, isFalse);
    expect(setup.host.count('stopSession'), 0);
    expect(_saved(setup)?.positionSec, closeTo(12, 0.01));
    expect(setup.active, [true, false]);
  });

  group('a new interface language', () {
    test('stops the running walk with its place saved', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 25000));
      walk.localeChanged(AppLocale.en);
      await pumpEventQueue();
      expect(walk.state.active, isFalse);
      expect(setup.host.count('stopSession'), 1);
      expect(_saved(setup)?.positionSec, closeTo(25, 0.01));
      expect(walk.resumable, isTrue);
    });

    test('changes nothing for the same language or a walk that has not started', () async {
      final setup = await _setup();
      final walk = setup.walk();
      walk.localeChanged(AppLocale.en);
      await walk.start(locationGranted: true);
      walk.localeChanged(AppLocale.ru);
      await pumpEventQueue();
      expect(walk.state.active, isTrue);
      expect(setup.host.count('stopSession'), 0);
    });
  });

  group('one recording at a time', () {
    test('a story does not interrupt a walk without asking', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      final story = setup.story();
      await story.play(StoryAudioRequest(placeId: 'osm:node:1', url: Uri.parse('https://otgolosok.online/a.mp3'), title: 'Дом', subtitle: 'Улица'));
      expect(story.state.phase, StoryAudioPhase.failed);
      expect(story.state.error, StoryListenController.walkRunning);
      expect(walk.state.active, isTrue);
      expect(setup.host.count('startSession'), 1);
    });

    test('a confirmed story takes the session over: the walk stops with its place saved', () async {
      final setup = await _setup();
      final walk = await _playing(setup);
      walk.onPlayer(_player(audioOf('a'), ws.PlaybackState.playing, positionMs: 18000));
      final story = setup.story();
      final url = Uri.parse('https://otgolosok.online/story.mp3');
      await story.play(StoryAudioRequest(placeId: 'osm:node:1', url: url, title: 'Дом', subtitle: 'Улица'), takeOver: true);
      await pumpEventQueue();
      expect(walk.state.active, isFalse);
      expect(_saved(setup)?.positionSec, closeTo(18, 0.01));
      // The session is reconfigured, not stopped and started again.
      expect(setup.host.count('stopSession'), 0);
      expect(setup.host.sessions.last.kind, ws.SessionKind.listen);
      expect(setup.host.sessions.last.tracking, isFalse);
      expect(setup.host.sessions.last.contentRoute, '/?place=osm%3Anode%3A1');
      expect(setup.host.tracks.last.uri, url.toString());
      expect(setup.hub.owner, same(story));
      // Late walk events no longer reach the walk.
      setup.hub.onPlayer(_player(url.toString(), ws.PlaybackState.playing));
      expect(story.state.phase, StoryAudioPhase.playing);
      expect(walk.state.active, isFalse);
    });

    test('a walk started over a story ends the story', () async {
      final setup = await _setup();
      final story = setup.story();
      final url = Uri.parse('https://otgolosok.online/story.mp3');
      await story.play(StoryAudioRequest(placeId: 'osm:node:1', url: url, title: 'Дом', subtitle: 'Улица'));
      setup.hub.onPlayer(_player(url.toString(), ws.PlaybackState.playing));
      expect(story.state.phase, StoryAudioPhase.playing);
      final walk = setup.walk();
      expect(await walk.start(locationGranted: true), isTrue);
      expect(story.state.phase, StoryAudioPhase.idle);
      expect(setup.hub.owner, same(walk));
    });

    test('a story that ended frees the service', () async {
      final setup = await _setup();
      final story = setup.story();
      final url = Uri.parse('https://otgolosok.online/story.mp3');
      await story.play(StoryAudioRequest(placeId: 'osm:node:1', url: url, title: 'Дом', subtitle: 'Улица'));
      setup.hub.onPlayer(_player(url.toString(), ws.PlaybackState.ended));
      await pumpEventQueue();
      expect(story.state.phase, StoryAudioPhase.idle);
      expect(setup.hub.owner, isNull);
      expect(setup.host.count('stopSession'), 1);
    });

    test('a story that cannot start says so in the site words', () async {
      final setup = await _setup();
      setup.host.refusals['play'] = ['player_error'];
      final story = setup.story();
      await story.play(StoryAudioRequest(placeId: 'osm:node:1', url: Uri.parse('https://otgolosok.online/s.mp3'), title: 'Дом', subtitle: ''));
      expect(story.state.phase, StoryAudioPhase.failed);
      expect(story.state.error, WalkServiceMessages.storyGeneric);
      expect(setup.hub.owner, isNull);
    });
  });
}
