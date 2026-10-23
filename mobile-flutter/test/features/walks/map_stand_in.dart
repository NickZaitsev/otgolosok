import 'package:flutter/widgets.dart';
import 'package:otgolosok/features/walks/route_map.dart';

/// The walk map without MapLibre: widget tests read what it was asked to draw.
class WalkMapStandIn {
  WalkMapProps? last;

  late final override = walkRouteMapProvider.overrideWithValue((context, props) {
    last = props;
    return Semantics(label: props.label, child: const SizedBox.expand());
  });
}
