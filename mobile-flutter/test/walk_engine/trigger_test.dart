import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/replay.dart';
import 'package:otgolosok/walk_engine/trigger.dart';

import 'fixture_loader.dart';

GeoPoint point(Object? json) => GeoPoint(number(asMap(json)['lat']), number(asMap(json)['lon']));

PositionFix fix(Object? json) {
  final map = asMap(json);
  return PositionFix(
    lat: number(map['lat']),
    lon: number(map['lon']),
    accuracyM: number(map['accuracyM']),
    timestampMs: number(map['timestampMs']),
  );
}

TriggerConfig config(Object? json) {
  final map = asMap(json);
  return TriggerConfig(
    enterM: number(map['enterM']),
    exitM: number(map['exitM']),
    minFixes: map['minFixes']! as int,
    windowSize: map['windowSize']! as int,
    maxAccuracyM: number(map['maxAccuracyM']),
  );
}

Map<String, Object?> encodeResult(TriggerResult result) => {
  'distanceM': result.distanceM,
  'event': result.event == null
      ? null
      : {
          'distanceM': result.event!.distanceM,
          'timestampMs': result.event!.timestampMs,
          'type': result.event!.type.name,
        },
  'ignored': result.ignored,
  'state': {'phase': result.state.phase.name, 'recentInside': result.state.recentInside},
};

void main() {
  final fixture = loadFixture('engine/trigger.json');

  test('default config matches the site', () {
    expect(config(fixture['defaultConfig']), defaultTriggerConfig);
  });

  group('distanceMeters', () {
    for (final item in asList(fixture['distances'])) {
      final map = asMap(item);
      test('${map['from']} → ${map['to']}', () {
        expect(distanceMeters(point(map['from']), point(map['to'])), number(map['meters']));
      });
    }
  });

  group('processFix scenarios', () {
    for (final item in asList(fixture['scenarios'])) {
      final scenario = asMap(item);
      test(scenario['name']! as String, () {
        final state = asMap(scenario['state']);
        var current = TriggerState(
          TriggerPhase.values.byName(state['phase']! as String),
          asList(state['recentInside']).cast<bool>(),
        );
        final steps = asList(scenario['steps']);
        final expected = asList(scenario['results']);
        for (var index = 0; index < steps.length; index += 1) {
          final step = asMap(steps[index]);
          final result = processFix(
            current,
            fix(step['fix']),
            point(scenario['target']),
            config(scenario['config']),
            step['busy']! as bool,
          );
          expect(encodeResult(result), expected[index], reason: 'step $index');
          current = result.state;
        }
      });
    }
  });

  test('clean replay track equals the site track', () {
    final scenario = asList(fixture['scenarios'])
        .map(asMap)
        .firstWhere((item) => item['name'] == 'clean replay track');
    expect(point(scenario['target']), cleanReplayTarget);
    expect(cleanReplayTrack, [for (final step in asList(scenario['steps'])) fix(asMap(step)['fix'])]);
  });

  test('walk replay track follows the routed line like the site', () {
    final replay = asMap(fixture['replay']);
    final path = asList(replay['path']).map(point).toList();
    expect(createWalkReplayTrack(path), asList(replay['fixes']).map(fix).toList());
  });

  test('walk replay rejects a path without two finite points', () {
    expect(createWalkReplayTrack(const [GeoPoint(55.73, 37.64)]), isEmpty);
    expect(createWalkReplayTrack(const [GeoPoint(55.73, 37.64), GeoPoint(double.nan, 37.64)]), isEmpty);
    expect(
      createWalkReplayTrack(const [GeoPoint(55.73, 37.64), GeoPoint(55.731, 37.64)], stepM: 0),
      isEmpty,
    );
  });

  test('replay interval follows the speed, clamped to 1..20', () {
    expect(walkReplayIntervalMs, 5714);
    expect(walkReplayIntervalFor(1), 5714);
    expect(walkReplayIntervalFor(4), 1429);
    expect(walkReplayIntervalFor(50), 286);
    expect(walkReplayIntervalFor(0), 5714);
    expect(walkReplayIntervalFor(double.nan), 5714);
  });
}
