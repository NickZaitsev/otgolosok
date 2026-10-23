// Port of src/features/food/food-walk-model.ts: food places along a walk, split by the walker's position and
// grouped by stop, plus safe links from OSM contact fields. The hours cache lives in opening_hours.dart.
import 'package:flutter/foundation.dart';

import 'route_proximity.dart';

final _phoneSeparator = RegExp(r'[;,]');
final _phoneNoise = RegExp(r'[\s().-]');
final _phone = RegExp(r'^\+?\d+$');

List<RouteFoodPlace> _ordered(List<RouteFoodPlace> places) => [...places]..sort((a, b) {
    final along = a.alongM.compareTo(b.alongM);
    // OSM ids are ASCII, where code unit order equals the site's `localeCompare`.
    return along != 0 ? along : a.id.compareTo(b.id);
  });

/// Places from [fromM] along the route on ([ahead], the start of a section included) and before it ([behind]),
/// both ordered along the route. [places] is not modified.
({List<RouteFoodPlace> ahead, List<RouteFoodPlace> behind}) splitRouteFood(List<RouteFoodPlace> places, double fromM) {
  final sorted = _ordered(places);
  return (ahead: [for (final place in sorted) if (place.alongM >= fromM) place], behind: [for (final place in sorted) if (place.alongM < fromM) place]);
}

/// A run of consecutive places (along the route) nearest to the same stop; [stop] is null when the walk has none.
@immutable
class RouteFoodGroup {
  const RouteFoodGroup(this.stop, this.places);

  final int? stop;
  final List<RouteFoodPlace> places;
}

/// Places ordered along the route, grouped by their nearest stop; [stops] are the stops' distances along the route.
List<RouteFoodGroup> groupRouteFood(List<RouteFoodPlace> places, List<double> stops) {
  final groups = <RouteFoodGroup>[];
  for (final place in _ordered(places)) {
    final stop = nearestStop(place.alongM, stops);
    if (groups.isEmpty || groups.last.stop != stop) groups.add(RouteFoodGroup(stop, []));
    groups.last.places.add(place);
  }
  return groups;
}

/// The OSM `website` as an http(s) link, or null for any other scheme or a malformed value.
Uri? foodWebsite(String? value) {
  if (value == null || value.isEmpty) return null;
  final uri = Uri.tryParse(value.trim());
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https') && uri.host.isNotEmpty ? uri : null;
}

/// A `tel:` link to the first OSM `phone` number, or null when it is not a plain (optionally `+`) digit string.
Uri? foodPhone(String? value) {
  // OSM lists several numbers with ";" or ","; the first one is the main line.
  final cleaned = (value ?? '').split(_phoneSeparator).first.replaceAll(_phoneNoise, '');
  return _phone.hasMatch(cleaned) ? Uri(scheme: 'tel', path: cleaned) : null;
}
