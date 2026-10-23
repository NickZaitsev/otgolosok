// Port of src/features/tour/walk-direction.ts.
import 'route.dart';
import 'walk_view.dart' show TunnelRange;

enum WalkDirection { forward, reverse }

/// The walk walked backwards: reuses the checked pedestrian path and the
/// recordings without changing the published walk. Car routes keep their direction.
Route orientWalk(Route route, WalkDirection direction) {
  final walk = route.walk;
  if (direction == WalkDirection.forward ||
      walk == null ||
      walk.car != null ||
      walk.path.costing == PathCosting.auto) {
    return route;
  }
  final last = walk.path.coordinates.length - 1;
  final tunnels = walk.path.tunnels;
  return route.withWalk(
    WalkPlan(
      car: walk.car,
      start: walk.finish,
      finish: walk.start,
      distanceM: walk.distanceM,
      walkingMin: walk.walkingMin,
      fieldChecked: walk.fieldChecked,
      steps: [
        for (final step in walk.steps.reversed) step.withHints(transition: '', nextHint: ''),
      ],
      path: WalkPath(
        coordinates: walk.path.coordinates.reversed.toList(),
        provider: walk.path.provider,
        costing: walk.path.costing,
        tunnels: tunnels == null
            ? null
            : [
                for (final tunnel in tunnels.reversed)
                  TunnelRange(last - tunnel.end, last - tunnel.start),
              ],
      ),
    ),
  );
}
