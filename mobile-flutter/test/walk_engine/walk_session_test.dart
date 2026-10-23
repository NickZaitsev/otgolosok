import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/checkpoint.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/route.dart';
import 'package:otgolosok/walk_engine/trigger.dart';
import 'package:otgolosok/walk_engine/walk_direction.dart';
import 'package:otgolosok/walk_engine/walk_plan.dart';
import 'package:otgolosok/walk_engine/walk_route.dart';
import 'package:otgolosok/walk_engine/walk_session.dart';
import 'package:otgolosok/walk_engine/walk_settings.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'fixture_loader.dart';

final Map<String, Object?> _plan = loadFixture('engine/walk_plan.json');

/// The published (forward) walk of a walk_plan fixture case: stops a, b, c.
/// «near finish» ends next to c (no finish leg); «far finish» ends 300 m away.
Route publishedWalk(String caseName) {
  final sample = asList(_plan['cases']).map(asMap).firstWhere((item) => item['name'] == caseName);
  return walkViewToRoute(WalkView.fromJson(sample['view']));
}

const String near = 'near finish, forward';
const String far = 'far finish, forward';

/// A compact text of a player command: chapters are named by the letter of their recording.
String describe(PlayerCommand command) => switch (command) {
  PlayTrack(:final track, :final startPositionSec, :final rate) =>
    'play ${letter(track.url)}@${startPositionSec.toStringAsFixed(0)}x$rate',
  PausePlayback() => 'pause',
  ResumePlayback() => 'resume',
  SeekTo(:final positionSec) => 'seek ${positionSec.toStringAsFixed(0)}',
  SetRate(:final rate) => 'rate $rate',
  PrefetchAudio(:final url) => 'prefetch ${letter(url)}',
  StopPlayback(:final endOfWalk) => endOfWalk ? 'end' : 'stop',
};

String letter(String url) => url.split('/').last.substring(0, 1);

class Harness {
  Harness(
    String caseName, {
    AdvanceMode advance = AdvanceMode.place,
    InMemoryCheckpointStore? store,
    Future<void> Function()? reportLaunch,
  }) : store = store ?? InMemoryCheckpointStore() {
    session = WalkSession(
      route: publishedWalk(caseName),
      checkpoints: this.store,
      reportLaunch: reportLaunch,
      settings: WalkSettings(advance: advance, rate: 1),
    );
    session.commands.listen((command) => commands.add(describe(command)));
    session.cards.listen(cards.add);
  }

  late final WalkSession session;
  final InMemoryCheckpointStore store;
  final List<String> commands = [];
  final List<CardState> cards = [];
  double _clock = 0;

  WalkUiState get state => session.state;

  CardState get card => session.card;

  String url(int chapter) => session.chapters[chapter].audio!.url;

  /// Lets the broadcast streams deliver and returns the commands since the last call.
  Future<List<String>> drain() async {
    await Future<void>.delayed(Duration.zero);
    final drained = List.of(commands);
    commands.clear();
    return drained;
  }

  void fixesAt(GeoPoint point, {int count = 5, double accuracyM = 5}) {
    for (var index = 0; index < count; index += 1) {
      _clock += 1000;
      session.onFix(PositionFix(lat: point.lat, lon: point.lon, accuracyM: accuracyM, timestampMs: _clock));
    }
  }

  /// Stands at the place the walk listens for now long enough to trigger.
  void reachTarget() => fixesAt(state.target);

  void player(PlayerStatus status, double positionSec, {int? chapter}) => session.onPlayerState(
    PlayerSnapshot(
      url: chapter == null ? state.audioUrl : url(chapter),
      status: status,
      positionSec: positionSec,
      durationSec: 60,
    ),
  );

  String get checkpointKey => walkCheckpointKey(session.route.id, PlaybackLocale.ru, state.direction);

  /// The stored resume point as chapter id and position.
  (String, double)? get saved {
    final raw = store.values[checkpointKey];
    if (raw == null) return null;
    final json = jsonDecode(raw) as Map<String, Object?>;
    return (json['chapterId']! as String, (json['positionSec']! as num).toDouble());
  }
}

void main() {
  group('advance modes', () {
    final cases = <({
      AdvanceMode mode,
      StopStage startStage,
      List<String> onStart,
      (int, StopStage) afterArrival,
      List<String> onArrival,
      (int, StopStage) afterTrackEnd,
      List<String> onTrackEnd,
    })>[
      (
        mode: AdvanceMode.place,
        startStage: StopStage.approach,
        onStart: [],
        afterArrival: (0, StopStage.stop),
        onArrival: ['play a@0x1.0', 'prefetch b'],
        afterTrackEnd: (0, StopStage.stop),
        onTrackEnd: [],
      ),
      (
        mode: AdvanceMode.manual,
        startStage: StopStage.approach,
        onStart: [],
        afterArrival: (0, StopStage.approach),
        onArrival: [],
        afterTrackEnd: (0, StopStage.approach),
        onTrackEnd: [],
      ),
      (
        mode: AdvanceMode.sequence,
        startStage: StopStage.stop,
        onStart: ['play a@0x1.0', 'prefetch b'],
        afterArrival: (0, StopStage.stop),
        onArrival: [],
        afterTrackEnd: (1, StopStage.stop),
        onTrackEnd: ['stop', 'play b@0x1.0', 'prefetch c'],
      ),
    ];
    for (final row in cases) {
      test(row.mode.name, () async {
        final walk = Harness(near, advance: row.mode);
        expect(walk.session.start(), isTrue);
        expect(walk.state.stage, row.startStage);
        expect(await walk.drain(), row.onStart);

        walk.reachTarget();
        expect((walk.state.chapterIndex, walk.state.stage), row.afterArrival, reason: 'after reaching the target');
        expect(await walk.drain(), row.onArrival);

        walk.session.onTrackEnded(walk.url(0));
        expect((walk.state.chapterIndex, walk.state.stage), row.afterTrackEnd, reason: 'after the story ended');
        expect(await walk.drain(), row.onTrackEnd);
      });
    }
  });

  test('«По месту» is the default advance mode', () {
    final session = WalkSession(route: publishedWalk(near), checkpoints: InMemoryCheckpointStore());
    expect(session.state.advance, AdvanceMode.place);
  });

  test('approach and stop stages listen for different places', () async {
    final walk = Harness(near);
    walk.session.start();
    final a = walk.session.chapters[0];
    final b = walk.session.chapters[1];

    expect(walk.state.target, const GeoPoint(55.75205, 37.59305), reason: 'the trigger point of a');
    expect(walk.state.leg, 0);
    expect(walk.card.stage, CardStage.approach);
    expect(walk.card.nextStopTitle, a.title);

    walk.reachTarget();
    expect(walk.state.stage, StopStage.stop);
    expect(walk.state.target, const GeoPoint(55.753, 37.595), reason: 'the place of b');
    expect(walk.state.leg, 1);
    expect(walk.state.nextStopTitle, b.title);
    expect(walk.card.stage, CardStage.playing);
    expect(walk.card.nextStopTitle, b.title);
  });

  test('a playing story withholds the arrival at the next stop', () async {
    final walk = Harness(near);
    walk.session.start();
    walk.reachTarget();
    walk.player(PlayerStatus.playing, 5);
    await walk.drain();

    walk.fixesAt(walk.state.target);
    expect(walk.state.chapterIndex, 0, reason: 'a is still playing');
    expect(await walk.drain(), isEmpty);

    walk.session.onTrackEnded(walk.url(0));
    walk.fixesAt(walk.state.target, count: 1);
    expect((walk.state.chapterIndex, walk.state.stage), (1, StopStage.stop));
    expect(await walk.drain(), ['stop', 'play b@0x1.0', 'prefetch c']);
  });

  group('the last stop', () {
    final cases = <({String name, bool finishLeg, NextAction action})>[
      (name: near, finishLeg: false, action: NextAction.finish),
      (name: far, finishLeg: true, action: NextAction.toFinish),
    ];
    for (final row in cases) {
      test('${row.name}: «Дальше» on the last stop', () async {
        final walk = Harness(row.name);
        walk.session.start(index: 2);
        walk.reachTarget();
        expect(walk.state.finishLeg, row.finishLeg);
        expect(walk.state.nextAction, row.action);
        expect(walk.state.hasNext, isFalse);
        await walk.drain();

        walk.session.next();
        if (!row.finishLeg) {
          expect(walk.state.active, isFalse);
          expect(walk.state.completed, isTrue);
          expect(await walk.drain(), ['end']);
          expect(walk.saved, isNull, reason: 'a finished walk starts over');
          return;
        }
        expect(walk.state.active, isTrue);
        expect((walk.state.chapterIndex, walk.state.stage), (3, StopStage.approach));
        expect(walk.state.chapterTitle, isNull);
        expect(walk.card.nextStopTitle, walk.session.route.walk!.finish.address);
        expect(walk.state.target, walk.session.route.walk!.finish.location);
        expect(await walk.drain(), isEmpty, reason: 'the last story keeps playing');

        walk.session.onTrackEnded(walk.url(2));
        walk.reachTarget();
        expect(walk.state.completed, isTrue);
        expect(walk.card.stage, CardStage.finished);
      });
    }

    test('far finish: «По месту» ends the walk at the finish without a button', () {
      final walk = Harness(far);
      walk.session.start(index: 2);
      walk.reachTarget();
      walk.session.onTrackEnded(walk.url(2));
      expect(walk.state.target, walk.session.route.walk!.finish.location);
      walk.reachTarget();
      expect(walk.state.completed, isTrue);
    });

    test('near finish: arriving after the last stop changes nothing', () {
      final walk = Harness(near);
      walk.session.start(index: 2);
      walk.reachTarget();
      walk.session.onTrackEnded(walk.url(2));
      walk.reachTarget();
      expect(walk.state.active, isTrue);
      expect(walk.state.chapterIndex, 2);
    });
  });

  test('manual next, previous and the lock screen buttons', () async {
    final walk = Harness(near, advance: AdvanceMode.manual);
    walk.session.start();
    expect(walk.state.hasPrevious, isFalse);

    walk.session.previous();
    expect(walk.state.chapterIndex, 0);

    walk.session.next();
    expect((walk.state.chapterIndex, walk.state.stage), (1, StopStage.approach));
    expect(walk.state.hasPrevious, isTrue);
    expect(await walk.drain(), ['stop'], reason: 'manual mode does not play on its own');

    walk.session.play();
    expect(walk.state.stage, StopStage.stop, reason: 'play on the way means the walker is there');
    expect(await walk.drain(), ['play b@0x1.0', 'prefetch c']);

    walk.session.previous();
    expect((walk.state.chapterIndex, walk.state.stage), (0, StopStage.approach));
    expect(await walk.drain(), ['stop']);

    walk.session.skipToNext();
    walk.session.skipToNext();
    expect(walk.state.chapterIndex, 2);
    walk.session.skipToNext();
    expect(walk.state.chapterIndex, 2, reason: 'the lock screen never finishes the walk');
    expect(walk.state.active, isTrue);
  });

  test('events of a story the walk already left are ignored', () {
    final walk = Harness(near, advance: AdvanceMode.manual);
    walk.session.start();
    walk.session.play();
    walk.session.next();
    walk.player(PlayerStatus.playing, 40, chapter: 0);
    expect(walk.state.audioStatus, WalkAudioStatus.ready);
    expect(walk.state.positionSec, 0);
    walk.session.onTrackEnded(walk.url(0));
    expect(walk.state.audioStatus, WalkAudioStatus.ready);
  });

  group('position status', () {
    final cases = <({
      String name,
      PositionStatus status,
      PositionFix? fix,
      AdvanceMode advance,
      StatusText text,
      AdvanceMode effective,
    })>[
      (
        name: 'denied in «По месту»',
        status: PositionStatus.permissionDenied,
        fix: null,
        advance: AdvanceMode.place,
        text: const StatusText(statusDenied),
        effective: AdvanceMode.manual,
      ),
      (
        name: 'denied in «Подряд»',
        status: PositionStatus.permissionDenied,
        fix: null,
        advance: AdvanceMode.sequence,
        text: const StatusText(statusDenied),
        effective: AdvanceMode.sequence,
      ),
      (
        name: 'unavailable',
        status: PositionStatus.unavailable,
        fix: null,
        advance: AdvanceMode.place,
        text: const StatusText(statusNoSignal),
        effective: AdvanceMode.manual,
      ),
      (
        name: 'error',
        status: PositionStatus.error,
        fix: null,
        advance: AdvanceMode.place,
        text: const StatusText(statusNoSignal),
        effective: AdvanceMode.manual,
      ),
      (
        name: 'replay complete',
        status: PositionStatus.complete,
        fix: null,
        advance: AdvanceMode.place,
        text: const StatusText(statusReplayComplete),
        effective: AdvanceMode.place,
      ),
      (
        name: 'no fix yet',
        status: PositionStatus.active,
        fix: null,
        advance: AdvanceMode.place,
        text: const StatusText(statusSearching),
        effective: AdvanceMode.place,
      ),
      (
        name: 'coarse fix',
        status: PositionStatus.active,
        fix: const PositionFix(lat: 55.75, lon: 37.59, accuracyM: 80.5, timestampMs: 1),
        advance: AdvanceMode.place,
        text: const StatusText(statusRefining, {'distance': 81}),
        effective: AdvanceMode.place,
      ),
      (
        name: 'accurate fix away from the stop',
        status: PositionStatus.active,
        fix: const PositionFix(lat: 55.75, lon: 37.59, accuracyM: 12.4, timestampMs: 1),
        advance: AdvanceMode.place,
        text: const StatusText(statusListening, {'distance': 12}),
        effective: AdvanceMode.place,
      ),
    ];
    for (final row in cases) {
      test(row.name, () {
        final walk = Harness(near, advance: row.advance);
        walk.session.start();
        walk.session.onPositionStatus(row.status);
        if (row.fix case final fix?) walk.session.onFix(fix);
        expect(walk.state.statusText, row.text);
        expect(walk.state.effectiveAdvance, row.effective);
        expect(walk.state.advance, row.advance, reason: 'the chosen mode is kept');
      });
    }

    test('denied location still plays by the button', () async {
      final walk = Harness(near);
      walk.session.start();
      walk.session.onPositionStatus(PositionStatus.permissionDenied);
      expect(walk.state.positionDenied, isTrue);
      walk.session.play();
      expect(await walk.drain(), ['play a@0x1.0', 'prefetch b']);
    });
  });

  test('resume point: saved after 2 s of progress, on pause and on stop', () async {
    final walk = Harness(near);
    walk.session.start();
    expect(walk.saved, ('a-stop', 0.0), reason: 'the chapter is remembered on start');

    walk.reachTarget();
    walk.player(PlayerStatus.playing, 1.5);
    expect(walk.saved, ('a-stop', 0.0), reason: 'less than 2 s of progress');
    walk.player(PlayerStatus.playing, 2.5);
    expect(walk.saved, ('a-stop', 2.5));
    walk.player(PlayerStatus.playing, 3.9);
    expect(walk.saved, ('a-stop', 2.5));

    walk.session.pause();
    expect(walk.saved, ('a-stop', 3.9));
    expect(walk.card.stage, CardStage.paused);
    walk.player(PlayerStatus.paused, 3.9);
    await walk.drain();

    walk.session.play();
    expect(await walk.drain(), ['resume'], reason: 'the loaded track continues');
    walk.player(PlayerStatus.playing, 4.4);
    walk.session.stop();
    expect(walk.saved, ('a-stop', 4.4));
    expect(walk.state.stoppedChapter, 0);
    expect(await walk.drain(), ['end']);
    final stages = [
      for (final (index, card) in walk.cards.indexed)
        if (index == 0 || walk.cards[index - 1].stage != card.stage) card.stage,
    ];
    expect(walk.cards.length, greaterThan(stages.length), reason: 'the distance updates the card too');
    expect(stages, [
      CardStage.approach,
      CardStage.playing,
      CardStage.paused,
      CardStage.playing,
      CardStage.finished,
    ]);
  });

  group('resume from a checkpoint', () {
    final cases = <({
      String name,
      String? chapterId,
      String? audioOf,
      double position,
      bool resume,
      int index,
      StopStage stage,
      List<String> commands,
    })>[
      (
        name: 'continues the story it was listening to',
        chapterId: 'b-stop',
        audioOf: 'b-stop',
        position: 30,
        resume: true,
        index: 1,
        stage: StopStage.stop,
        commands: ['play b@30x1.0', 'prefetch c'],
      ),
      (
        name: 'a story not started yet waits for the stop',
        chapterId: 'b-stop',
        audioOf: 'b-stop',
        position: 0.5,
        resume: true,
        index: 1,
        stage: StopStage.approach,
        commands: [],
      ),
      (
        name: 'a re-recorded story starts over',
        chapterId: 'b-stop',
        audioOf: 'c-stop',
        position: 30,
        resume: true,
        index: 0,
        stage: StopStage.approach,
        commands: [],
      ),
      (
        name: 'starting over ignores the checkpoint',
        chapterId: 'b-stop',
        audioOf: 'b-stop',
        position: 30,
        resume: false,
        index: 0,
        stage: StopStage.approach,
        commands: [],
      ),
      (
        name: 'no checkpoint',
        chapterId: null,
        audioOf: null,
        position: 0,
        resume: true,
        index: 0,
        stage: StopStage.approach,
        commands: [],
      ),
    ];
    for (final row in cases) {
      test(row.name, () async {
        final route = publishedWalk(near);
        final chapters = getWalkChapters(route, includePending: true);
        final store = InMemoryCheckpointStore();
        if (row.chapterId case final chapterId?) {
          final audio = chapters.firstWhere((chapter) => chapter.id == row.audioOf).audio!;
          store.values[walkCheckpointKey(route.id, PlaybackLocale.ru, WalkDirection.forward)] = PlaybackCheckpoint(
            routeId: route.id,
            chapterId: chapterId,
            audioUrl: audio.url,
            positionSec: row.position,
          ).serialize();
        }
        final walk = Harness(near, store: store);
        expect(walk.session.start(resume: row.resume), isTrue);
        expect((walk.state.chapterIndex, walk.state.stage), (row.index, row.stage));
        expect(await walk.drain(), row.commands);
      });
    }

    test('the player reports of the seek to the saved position do not overwrite it', () {
      final route = publishedWalk(near);
      final b = getWalkChapters(route)[1];
      final store = InMemoryCheckpointStore();
      final key = walkCheckpointKey(route.id, PlaybackLocale.ru, WalkDirection.forward);
      store.values[key] = PlaybackCheckpoint(routeId: route.id, chapterId: b.id, audioUrl: b.audio!.url, positionSec: 30).serialize();
      final walk = Harness(near, store: store);
      walk.session.start();
      walk.player(PlayerStatus.loading, 0);
      expect(walk.state.positionSec, 30);
      expect(walk.saved, ('b-stop', 30.0));
      walk.player(PlayerStatus.playing, 30.2);
      expect(walk.state.positionSec, 30.2);
    });
  });

  test('reverse direction walks the stops backwards with its own checkpoint', () async {
    final walk = Harness(near);
    walk.store.values[walkCheckpointKey(walk.session.route.id, PlaybackLocale.ru, WalkDirection.forward)] =
        PlaybackCheckpoint(
          routeId: walk.session.route.id,
          chapterId: 'b-stop',
          audioUrl: walk.url(1),
          positionSec: 30,
        ).serialize();

    walk.session.start(direction: WalkDirection.reverse);
    expect(walk.state.direction, WalkDirection.reverse);
    expect([for (final chapter in walk.session.chapters) chapter.id], ['c-stop', 'b-stop', 'a-stop']);
    expect((walk.state.chapterIndex, walk.state.stage), (0, StopStage.approach), reason: 'the forward checkpoint is not used');
    expect(walk.state.finishLeg, isTrue, reason: 'the reverse finish is far from a');
    expect(walk.checkpointKey, endsWith(':reverse'));
    expect(walk.saved, ('c-stop', 0.0));

    walk.reachTarget();
    expect(await walk.drain(), ['play c@0x1.0', 'prefetch b']);
    walk.session.stop();
    expect(walk.session.savedChapterIndex(WalkDirection.reverse), 0);
    expect(walk.session.savedChapterIndex(), 1);
  });

  test('a start from a stop walks forward from it', () {
    final walk = Harness(near);
    expect(() => walk.session.start(fromStop: 'missing'), throwsArgumentError);
    expect(walk.session.active, isFalse);
    expect(walk.session.start(fromStop: 'b-stop', direction: WalkDirection.reverse), isTrue);
    expect(walk.state.direction, WalkDirection.forward);
    expect(walk.state.chapterId, 'b-stop');
    expect(walk.session.start(), isFalse, reason: 'a walk is already running');
  });

  group('launch report', () {
    test('is sent once per session', () async {
      var launches = 0;
      final walk = Harness(near, reportLaunch: () async => launches += 1);
      walk.session.start();
      walk.session.stop();
      walk.session.start(resume: false);
      await walk.drain();
      expect(launches, 1);
    });

    final failures = <String, Future<void> Function()>{
      'an asynchronous failure': () => Future<void>.error(Exception('offline')),
      'a synchronous failure': () => throw StateError('broken'),
    };
    for (final MapEntry(key: name, value: report) in failures.entries) {
      test('$name does not stop the walk', () async {
        final walk = Harness(near, advance: AdvanceMode.sequence, reportLaunch: report);
        expect(walk.session.start(), isTrue);
        expect(await walk.drain(), ['play a@0x1.0', 'prefetch b']);
      });
    }
  });

  test('a failing checkpoint store does not stop the walk', () async {
    final session = WalkSession(
      route: publishedWalk(near),
      checkpoints: _FailingStore(),
      settings: const WalkSettings(advance: AdvanceMode.sequence, rate: 1),
    );
    final commands = <String>[];
    session.commands.listen((command) => commands.add(describe(command)));
    expect(session.start(), isTrue);
    session.pause();
    session.stop();
    await Future<void>.delayed(Duration.zero);
    expect(commands, ['play a@0x1.0', 'prefetch b', 'pause', 'end']);
  });

  test('rate: only the offered speeds, applied to the playing and the next tracks', () async {
    final walk = Harness(near, advance: AdvanceMode.sequence);
    walk.session.start();
    expect(() => walk.session.setRate(2), throwsArgumentError);
    walk.session.setRate(1.25);
    walk.session.onTrackEnded(walk.url(0));
    expect(await walk.drain(), ['play a@0x1.0', 'prefetch b', 'rate 1.25', 'stop', 'play b@0x1.25', 'prefetch c']);
  });

  test('seeking clamps to the recording and is saved', () async {
    final walk = Harness(near, advance: AdvanceMode.sequence);
    walk.session.start();
    expect(walk.state.canSeek, isFalse, reason: 'the duration is not known yet');
    walk.player(PlayerStatus.playing, 10);
    await walk.drain();
    walk.session.seekBy(-15);
    walk.session.seekTo(500);
    expect(await walk.drain(), ['seek 0', 'seek 60']);
    expect(walk.saved, ('a-stop', 60.0));
  });
}

class _FailingStore implements CheckpointStore {
  @override
  String? read(String key) => throw StateError('no storage');

  @override
  Future<void> write(String key, String value) => Future.error(StateError('no storage'));

  @override
  Future<void> remove(String key) => throw StateError('no storage');
}
