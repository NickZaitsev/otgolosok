// Port of src/features/tour/driving-plan.ts: the car walk reducer. One explicit
// action advances one real-world handoff; no GPS arrival starts a story.
import 'dart:convert';

import 'car_route.dart';
import 'js_json.dart';
import 'json_read.dart' show jsIsInteger;

sealed class DrivingPlanState {
  const DrivingPlanState();

  String get phase;

  Map<String, Object?> toJson();

  /// The visit the state is about, if any (`currentDrivingVisit`).
  int? get visitIndex => null;

  @override
  bool operator ==(Object other) =>
      other is DrivingPlanState && jsJsonStringify(other.toJson()) == jsJsonStringify(toJson());

  @override
  int get hashCode => jsJsonStringify(toJson()).hashCode;

  @override
  String toString() => jsJsonStringify(toJson());
}

final class DrivingOverview extends DrivingPlanState {
  const DrivingOverview();

  @override
  String get phase => 'overview';

  @override
  Map<String, Object?> toJson() => {'phase': phase};
}

final class DrivingToVisit extends DrivingPlanState {
  const DrivingToVisit(this.visitIndex);

  @override
  final int visitIndex;

  @override
  String get phase => 'driving';

  @override
  Map<String, Object?> toJson() => {'phase': phase, 'visitIndex': visitIndex};
}

final class DrivingVisiting extends DrivingPlanState {
  const DrivingVisiting(this.visitIndex, this.storyIndex);

  @override
  final int visitIndex;
  final int storyIndex;

  @override
  String get phase => 'visiting';

  @override
  Map<String, Object?> toJson() => {
    'phase': phase,
    'visitIndex': visitIndex,
    'storyIndex': storyIndex,
  };
}

final class DrivingReturning extends DrivingPlanState {
  const DrivingReturning(this.visitIndex);

  @override
  final int visitIndex;

  @override
  String get phase => 'returning';

  @override
  Map<String, Object?> toJson() => {'phase': phase, 'visitIndex': visitIndex};
}

final class DrivingFinishing extends DrivingPlanState {
  const DrivingFinishing();

  @override
  String get phase => 'finishing';

  @override
  Map<String, Object?> toJson() => {'phase': phase};
}

final class DrivingComplete extends DrivingPlanState {
  const DrivingComplete();

  @override
  String get phase => 'complete';

  @override
  Map<String, Object?> toJson() => {'phase': phase};
}

enum DrivingPlanAction {
  start('start'),
  parked('parked'),
  nextStory('next-story'),
  returnToCar('return-to-car'),
  atCar('at-car'),
  finishReached('finish-reached'),
  restart('restart');

  const DrivingPlanAction(this.wire);
  final String wire;
}

class DrivingPlanOptions {
  const DrivingPlanOptions({required this.finishRequired});

  final bool finishRequired;
}

DrivingPlanState initialDrivingPlanState() => const DrivingOverview();

DrivingPlanState _afterLastVisit(DrivingPlanOptions options) =>
    options.finishRequired ? const DrivingFinishing() : const DrivingComplete();

ParkingVisit? _visit(CarRoute route, int index) =>
    index >= 0 && index < route.visits.length ? route.visits[index] : null;

DrivingPlanState advanceDrivingPlan(
  DrivingPlanState state,
  DrivingPlanAction action,
  CarRoute route,
  DrivingPlanOptions options,
) {
  if (action == DrivingPlanAction.restart) return initialDrivingPlanState();
  switch ((state, action)) {
    case (DrivingOverview(), DrivingPlanAction.start):
      return route.visits.isNotEmpty ? const DrivingToVisit(0) : _afterLastVisit(options);
    case (DrivingToVisit(:final visitIndex), DrivingPlanAction.parked):
      final visit = _visit(route, visitIndex);
      if (visit == null) return initialDrivingPlanState();
      return visit.stopIds.isNotEmpty
          ? DrivingVisiting(visitIndex, 0)
          : DrivingReturning(visitIndex);
    case (DrivingVisiting(:final visitIndex, :final storyIndex), DrivingPlanAction.nextStory):
      final visit = _visit(route, visitIndex);
      if (visit != null && storyIndex + 1 < visit.stopIds.length) {
        return DrivingVisiting(visitIndex, storyIndex + 1);
      }
      return state;
    case (DrivingVisiting(:final visitIndex), DrivingPlanAction.returnToCar):
      return DrivingReturning(visitIndex);
    case (DrivingReturning(:final visitIndex), DrivingPlanAction.atCar):
      final next = visitIndex + 1;
      return next < route.visits.length ? DrivingToVisit(next) : _afterLastVisit(options);
    case (DrivingFinishing(), DrivingPlanAction.finishReached):
      return const DrivingComplete();
    default:
      return state;
  }
}

bool drivingAudioAllowed(DrivingPlanState state) => state is DrivingVisiting;

ParkingVisit? currentDrivingVisit(DrivingPlanState state, CarRoute route) {
  final index = state.visitIndex;
  return index == null ? null : _visit(route, index);
}

String? currentDrivingStopId(DrivingPlanState state, CarRoute route) {
  if (state is! DrivingVisiting) return null;
  final stops = _visit(route, state.visitIndex)?.stopIds;
  if (stops == null || state.storyIndex < 0 || state.storyIndex >= stops.length) return null;
  return stops[state.storyIndex];
}

class VisitStoryGroup {
  VisitStoryGroup(this.visitId, List<String> stopIds) : stopIds = List.unmodifiable(stopIds);

  final String visitId;
  final List<String> stopIds;
}

List<VisitStoryGroup> visitStoryGroups(CarRoute route, Set<String> knownStopIds) => [
  for (final visit in route.visits)
    VisitStoryGroup(visit.id, [
      for (var index = 0; index < visit.stopIds.length; index += 1)
        if (knownStopIds.contains(visit.stopIds[index]) &&
            visit.stopIds.indexOf(visit.stopIds[index]) == index)
          visit.stopIds[index],
    ]),
];

String drivingProgressKey(String documentId) => 'otgolosok:driving-progress:v1:$documentId';

/// The stored text of saved progress (`saveDrivingProgress`).
String serializeDrivingProgress(int revision, DrivingPlanState state) =>
    jsJsonStringify({'version': 1, 'revision': revision, 'state': state.toJson()});

int? _index(Object? value) => jsIsInteger(value) ? (value! as num).toInt() : null;

DrivingPlanState? _validState(Object? state, CarRoute route, DrivingPlanOptions options) {
  if (state is! Map<String, Object?>) return null;
  final phase = state['phase'];
  if (phase == 'overview') return const DrivingOverview();
  if (phase == 'complete') return const DrivingComplete();
  if (phase == 'finishing') return options.finishRequired ? const DrivingFinishing() : null;
  final visitIndex = _index(state['visitIndex']);
  if (visitIndex == null || visitIndex < 0 || visitIndex >= route.visits.length) return null;
  if (phase == 'driving') return DrivingToVisit(visitIndex);
  if (phase == 'returning') return DrivingReturning(visitIndex);
  final storyIndex = _index(state['storyIndex']);
  if (phase != 'visiting' || storyIndex == null) return null;
  final stories = route.visits[visitIndex].stopIds.length;
  return storyIndex >= 0 && storyIndex < stories ? DrivingVisiting(visitIndex, storyIndex) : null;
}

/// `loadDrivingProgress` over the stored text ([raw] is what the storage returned).
DrivingPlanState parseDrivingProgress(
  String? raw,
  int revision,
  CarRoute route,
  DrivingPlanOptions options,
) {
  if (raw == null || raw.isEmpty) return initialDrivingPlanState();
  final Object? saved;
  try {
    saved = jsonDecode(raw);
  } on FormatException {
    return initialDrivingPlanState();
  }
  if (saved is! Map<String, Object?> || saved['version'] != 1 || saved['revision'] != revision) {
    return initialDrivingPlanState();
  }
  return _validState(saved['state'], route, options) ?? initialDrivingPlanState();
}
