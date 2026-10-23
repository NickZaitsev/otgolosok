// Port of src/features/food/food-viewport.ts: which food markers the map draws.
import 'dart:math' show cos, pi;

import '../../walk_engine/distance.dart';
import '../explore/catalog_bounds.dart';
import 'food_model.dart';

/// Food markers appear from this MapLibre zoom (512 px tiles) on: the site's Leaflet z15.
const double foodMinZoom = 14;

/// At most this many markers, the closest to the map centre.
const int foodMarkerLimit = 300;

/// The places inside [bounds] (the required area: the view plus half a zoom step, not the story prefetch area),
/// closest to [center] first, at most [foodMarkerLimit]; none below [foodMinZoom]. [places] is not modified.
List<FoodPlace> visibleFoodPlaces(List<FoodPlace> places, {required CatalogBounds bounds, required GeoPoint center, required double zoom}) {
  if (zoom < foodMinZoom) return [];
  final scale = cos(center.lat * pi / 180);
  double distance(FoodPlace place) {
    final dy = place.lat - center.lat, dx = (place.lon - center.lon) * scale;
    return dy * dy + dx * dx;
  }

  final visible = [for (final place in places) if (bounds.containsPoint(place.location)) (place: place, distance: distance(place))];
  // OSM ids are ASCII, where code unit order equals the site's `localeCompare`.
  visible.sort((a, b) {
    final closer = a.distance.compareTo(b.distance);
    return closer != 0 ? closer : a.place.id.compareTo(b.place.id);
  });
  return [for (final entry in visible.take(foodMarkerLimit)) entry.place];
}
