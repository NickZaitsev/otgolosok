import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/car_route.dart';
import 'package:otgolosok/walk_engine/driving_plan.dart';

import 'fixture_loader.dart';

DrivingPlanState decodeState(Object? json) {
  final map = asMap(json);
  return switch (map['phase']) {
    'overview' => const DrivingOverview(),
    'driving' => DrivingToVisit(map['visitIndex']! as int),
    'visiting' => DrivingVisiting(map['visitIndex']! as int, map['storyIndex']! as int),
    'returning' => DrivingReturning(map['visitIndex']! as int),
    'finishing' => const DrivingFinishing(),
    'complete' => const DrivingComplete(),
    _ => throw ArgumentError.value(map['phase']),
  };
}

DrivingPlanAction decodeAction(Object? json) =>
    DrivingPlanAction.values.firstWhere((action) => action.wire == asMap(json)['type']);

void main() {
  final fixture = loadFixture('engine/driving_plan.json');
  final route = CarRoute.fromJson(fixture['route']);
  final empty = CarRoute(
    drivingMinutes: route.drivingMinutes,
    totalMinutes: route.totalMinutes,
    visits: const [],
    segments: const [],
  );

  test('every action from every phase', () {
    final transitions = asList(fixture['transitions']);
    expect(transitions, isNotEmpty);
    for (final item in transitions) {
      final row = asMap(item);
      final plan = row['route'] == 'empty' ? empty : route;
      final state = decodeState(row['state']);
      final action = decodeAction(row['action']);
      final options = DrivingPlanOptions(finishRequired: row['finishRequired']! as bool);
      expect(
        advanceDrivingPlan(state, action, plan, options).toJson(),
        row['result'],
        reason: '${row['route']} ${row['finishRequired']} $state ${action.wire}',
      );
    }
  });

  test('audio and the current stop per state', () {
    for (final item in asList(fixture['derived'])) {
      final row = asMap(item);
      final state = decodeState(row['state']);
      expect(drivingAudioAllowed(state), row['audioAllowed'], reason: '$state');
      expect(currentDrivingStopId(state, route), row['stopId'], reason: '$state');
    }
  });

  test('saved progress is used only when valid for this revision and route', () {
    for (final item in asList(fixture['saved'])) {
      final row = asMap(item);
      final options = DrivingPlanOptions(finishRequired: row['finishRequired']! as bool);
      expect(
        parseDrivingProgress(row['raw'] as String?, row['revision']! as int, route, options).toJson(),
        row['result'],
        reason: '${row['raw']} finishRequired=${row['finishRequired']}',
      );
    }
  });

  test('saved progress round-trips through its stored text', () {
    const options = DrivingPlanOptions(finishRequired: true);
    const state = DrivingVisiting(2, 0);
    final raw = serializeDrivingProgress(4, state);
    expect(raw, '{"version":1,"revision":4,"state":{"phase":"visiting","visitIndex":2,"storyIndex":0}}');
    expect(parseDrivingProgress(raw, 4, route, options), state);
    expect(parseDrivingProgress(raw, 5, route, options), const DrivingOverview());
    expect(drivingProgressKey('doc'), 'otgolosok:driving-progress:v1:doc');
  });
}
