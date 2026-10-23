import 'dart:async';

import '../../walk_engine/distance.dart';
import '../../walk_engine/replay.dart';
import '../../walk_engine/trigger.dart';

/// The site's `?replay=` tracks: `walk` follows the route line, `clean` is one stop's happy path.
enum ReplayMode { walk, clean }

/// Feeds a recorded track instead of GPS (debug builds only, from the diagnostics panel):
/// the port of the site's replay position source.
class ReplayPositionSource {
  ReplayPositionSource({required this.onFix, required this.onComplete});

  final void Function(PositionFix fix) onFix;
  final void Function() onComplete;
  Timer? _timer;

  bool get running => _timer != null;

  /// Starts [mode] along [path] at [speed] (1..20, as `?speed=`); false when the track is empty.
  bool start(ReplayMode mode, List<GeoPoint> path, {double speed = 1}) {
    stop();
    final fixes = switch (mode) {
      ReplayMode.walk => createWalkReplayTrack(path, intervalMs: walkReplayIntervalFor(speed)),
      ReplayMode.clean => cleanReplayTrack,
    };
    if (fixes.isEmpty) return false;
    final interval = mode == ReplayMode.walk ? walkReplayIntervalFor(speed) : cleanReplayIntervalMs;
    var next = 0;
    _timer = Timer.periodic(Duration(milliseconds: interval < 1 ? 1 : interval), (timer) {
      if (next >= fixes.length) {
        stop();
        onComplete();
        return;
      }
      onFix(fixes[next]);
      next += 1;
    });
    return true;
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }
}
