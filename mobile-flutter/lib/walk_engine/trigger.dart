// Port of src/lib/geo/trigger.ts and the trigger types of src/lib/geo/types.ts.
import 'distance.dart';

/// One position reading. `timestampMs` is a double because a source may report
/// a non-finite value, which the trigger must ignore.
class PositionFix extends GeoPoint {
  const PositionFix({
    required double lat,
    required double lon,
    required this.accuracyM,
    required this.timestampMs,
  }) : super(lat, lon);

  final double accuracyM;
  final double timestampMs;

  @override
  Map<String, Object?> toJson() => {
    'lat': lat,
    'lon': lon,
    'accuracyM': accuracyM,
    'timestampMs': timestampMs,
  };

  @override
  bool operator ==(Object other) =>
      other is PositionFix &&
      other.lat == lat &&
      other.lon == lon &&
      other.accuracyM == accuracyM &&
      other.timestampMs == timestampMs;

  @override
  int get hashCode => Object.hash(lat, lon, accuracyM, timestampMs);
}

class TriggerConfig {
  const TriggerConfig({
    required this.enterM,
    required this.exitM,
    required this.minFixes,
    required this.windowSize,
    required this.maxAccuracyM,
  });

  final double enterM;
  final double exitM;
  final int minFixes;
  final int windowSize;
  final double maxAccuracyM;

  Map<String, Object?> toJson() => {
    'enterM': enterM,
    'exitM': exitM,
    'minFixes': minFixes,
    'windowSize': windowSize,
    'maxAccuracyM': maxAccuracyM,
  };

  @override
  bool operator ==(Object other) =>
      other is TriggerConfig &&
      other.enterM == enterM &&
      other.exitM == exitM &&
      other.minFixes == minFixes &&
      other.windowSize == windowSize &&
      other.maxAccuracyM == maxAccuracyM;

  @override
  int get hashCode =>
      Object.hash(enterM, exitM, minFixes, windowSize, maxAccuracyM);

  @override
  String toString() => 'TriggerConfig(${toJson()})';
}

const TriggerConfig defaultTriggerConfig = TriggerConfig(
  enterM: 35,
  exitM: 60,
  minFixes: 3,
  windowSize: 5,
  maxAccuracyM: 50,
);

enum TriggerPhase { outside, inside, cooldown }

class TriggerState {
  TriggerState(this.phase, List<bool> recentInside)
    : recentInside = List.unmodifiable(recentInside);

  final TriggerPhase phase;
  final List<bool> recentInside;
}

TriggerState createTriggerState() => TriggerState(TriggerPhase.outside, []);

TriggerState resetTrigger() => createTriggerState();

enum TriggerEventType { entered, exited }

class TriggerEvent {
  const TriggerEvent(this.type, this.distanceM, this.timestampMs);

  final TriggerEventType type;
  final double distanceM;
  final double timestampMs;
}

class TriggerResult {
  const TriggerResult({
    required this.state,
    required this.event,
    required this.distanceM,
    required this.ignored,
  });

  final TriggerState state;
  final TriggerEvent? event;
  final double? distanceM;
  final bool ignored;
}

/// Feeds one fix into the arrival trigger.
///
/// Invalid or too inaccurate fixes are ignored. `entered` fires once the window
/// is full, at least `minFixes` of it lie inside `enterM`, the current fix is
/// inside and no audio is playing; `inside` turns into `cooldown` (with `exited`)
/// beyond `exitM` and stays there until the trigger is reset.
TriggerResult processFix(
  TriggerState state,
  PositionFix fix,
  GeoPoint target, [
  TriggerConfig config = defaultTriggerConfig,
  bool audioBusy = false,
]) {
  if (!fix.lat.isFinite ||
      fix.lat.abs() > 90 ||
      !fix.lon.isFinite ||
      fix.lon.abs() > 180 ||
      !fix.accuracyM.isFinite ||
      fix.accuracyM < 0 ||
      !fix.timestampMs.isFinite ||
      fix.accuracyM > config.maxAccuracyM) {
    return TriggerResult(
      state: state,
      event: null,
      distanceM: null,
      ignored: true,
    );
  }

  final distanceM = distanceMeters(fix, target);

  if (state.phase == TriggerPhase.cooldown) {
    return TriggerResult(
      state: state,
      event: null,
      distanceM: distanceM,
      ignored: false,
    );
  }

  if (state.phase == TriggerPhase.inside) {
    if (distanceM <= config.exitM) {
      return TriggerResult(
        state: state,
        event: null,
        distanceM: distanceM,
        ignored: false,
      );
    }
    return TriggerResult(
      state: TriggerState(TriggerPhase.cooldown, []),
      event: TriggerEvent(TriggerEventType.exited, distanceM, fix.timestampMs),
      distanceM: distanceM,
      ignored: false,
    );
  }

  final keep = config.windowSize > 1 ? config.windowSize - 1 : 0;
  final previous = state.recentInside;
  final recentInside = <bool>[
    ...previous.skip(previous.length > keep ? previous.length - keep : 0),
    distanceM <= config.enterM,
  ];
  final enoughInside =
      recentInside.length == config.windowSize &&
      recentInside.where((inside) => inside).length >= config.minFixes;
  final currentFixInside = distanceM <= config.enterM;

  if (!enoughInside || !currentFixInside || audioBusy) {
    return TriggerResult(
      state: TriggerState(TriggerPhase.outside, recentInside),
      event: null,
      distanceM: distanceM,
      ignored: false,
    );
  }

  return TriggerResult(
    state: TriggerState(TriggerPhase.inside, []),
    event: TriggerEvent(TriggerEventType.entered, distanceM, fix.timestampMs),
    distanceM: distanceM,
    ignored: false,
  );
}
