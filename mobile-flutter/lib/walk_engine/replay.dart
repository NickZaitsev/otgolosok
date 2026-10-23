// Debug position replays: ports of createWalkReplayTrack
// (src/lib/position/fixtures/walk.ts) and CLEAN_REPLAY_TRACK / TARGET
// (src/lib/position/fixtures/clean.ts). Only the diagnostics panel of debug
// builds feeds them to a walk.
import 'distance.dart';
import 'trigger.dart';

const double walkReplayStepM = 8;
const double walkReplayAccuracyM = 12;
const double walkReplaySpeedMps = 1.4;

/// Fixes are spaced by the time an unhurried walker needs to cover one step.
final int walkReplayIntervalMs = (walkReplayStepM / walkReplaySpeedMps * 1000).round();
const int _maxFixes = 2000;

/// The interval of the `walk` replay compressed by `speed` (clamped to 1..20,
/// like `?speed=` on the site).
int walkReplayIntervalFor(double speed) {
  final clamped = speed.isFinite && speed > 0 ? speed.clamp(1, 20).toDouble() : 1.0;
  return (walkReplayIntervalMs / clamped).round();
}

/// The `clean` replay plays one fix every 650 ms.
const int cleanReplayIntervalMs = 650;

/// A walker moving along the routed [path] at a steady pace, then [dwellFixes]
/// more fixes at the finish so the last trigger window can fill.
List<PositionFix> createWalkReplayTrack(
  List<GeoPoint> path, {
  double stepM = walkReplayStepM,
  double accuracyM = walkReplayAccuracyM,
  double startMs = 1000,
  int? intervalMs,
  int dwellFixes = 5,
}) {
  final interval = intervalMs ?? walkReplayIntervalMs;
  final points = path.where((point) => point.lat.isFinite && point.lon.isFinite).toList();
  if (points.length < 2 || !(stepM > 0) || interval < 0) return const [];

  final fixes = <PositionFix>[];
  void push(GeoPoint point) {
    if (fixes.length >= _maxFixes) return;
    fixes.add(
      PositionFix(
        lat: point.lat,
        lon: point.lon,
        accuracyM: accuracyM,
        timestampMs: startMs + fixes.length * interval,
      ),
    );
  }

  push(points.first);
  // Distance already covered since the last emitted fix.
  double carry = 0;
  for (var index = 1; index < points.length && fixes.length < _maxFixes; index += 1) {
    final from = points[index - 1];
    final to = points[index];
    final length = distanceMeters(from, to);
    if (!(length > 0)) continue;
    for (var travelled = stepM - carry; travelled <= length; travelled += stepM) {
      final ratio = travelled / length;
      push(GeoPoint(from.lat + (to.lat - from.lat) * ratio, from.lon + (to.lon - from.lon) * ratio));
    }
    // JavaScript `%` truncates like Dart's remainder, not like Dart's `%`.
    carry = (carry + length).remainder(stepM);
  }
  final finish = points.last;
  if (distanceMeters(fixes.last, finish) > 0) push(finish);
  for (var index = 0; index < dwellFixes; index += 1) {
    push(finish);
  }
  return fixes;
}

const GeoPoint cleanReplayTarget = GeoPoint(55.72326, 37.65309);

const double _metersPerLatitudeDegree = 111111;

PositionFix _fixNorthOfTarget(double distanceM, double accuracyM, double timestampMs) => PositionFix(
  lat: cleanReplayTarget.lat + distanceM / _metersPerLatitudeDegree,
  lon: cleanReplayTarget.lon,
  accuracyM: accuracyM,
  timestampMs: timestampMs,
);

/// Deterministic happy path for one stop: an ignored inaccurate fix, a window
/// with three fixes inside 35 m, a short stay, then an exit beyond 60 m.
final List<PositionFix> cleanReplayTrack = List.unmodifiable([
  _fixNorthOfTarget(18, 80, 1000),
  _fixNorthOfTarget(75, 8, 2000),
  _fixNorthOfTarget(30, 8, 3000),
  _fixNorthOfTarget(45, 8, 4000),
  _fixNorthOfTarget(20, 8, 5000),
  _fixNorthOfTarget(10, 8, 6000),
  _fixNorthOfTarget(25, 8, 7000),
  _fixNorthOfTarget(75, 8, 8000),
]);
