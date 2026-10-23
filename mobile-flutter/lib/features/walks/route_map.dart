// The map of one walk (site `MapShell` + `ExploreMap` in `walk-session.tsx` and `driving-experience.tsx`):
// the route line with its highlighted leg, numbered stops, the ends, parkings and the walker's position.
// The MapLibre widget sits behind [walkRouteMapProvider] so widget tests draw a plain stand-in.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../app/theme/tokens.g.dart';
import '../../walk_engine/distance.dart';
import '../explore/catalog_bounds.dart';
import '../explore/explore_map.dart' show addMapIcons, mapMaxZoom;
import '../explore/map_layers.dart' show MapMarker;
import '../walk_builder/builder_map.dart' show BuilderMarker, BuilderSegment;

/// A stretch of a walking line between two vertices (site `RouteRun`).
typedef RouteRun = ({int from, int to, bool covered, bool active});

/// Port of the site's `routeRuns`: the line of [length] vertices cut into runs at covered
/// stretches and at the highlighted leg, each vertex pair exactly once and in order.
List<RouteRun> routeRuns(int length, [List<(int, int)> tunnels = const [], (int, int)? active]) {
  if (length < 2) return const [];
  final last = length - 1;
  int clip(int value) => math.min(math.max(value, 0), last);
  final cuts = {0, last};
  for (final (a, b) in [...tunnels, ?active]) {
    cuts
      ..add(clip(a))
      ..add(clip(b));
  }
  final points = cuts.toList()..sort();
  final runs = <RouteRun>[];
  for (var i = 1; i < points.length; i++) {
    final from = points[i - 1], to = points[i];
    final covered = tunnels.any((range) => range.$1 <= from && to <= range.$2);
    final inLeg = active != null && active.$1 <= from && to <= active.$2;
    if (runs.isNotEmpty && runs.last.covered == covered && runs.last.active == inLeg) {
      runs.last = (from: runs.last.from, to: to, covered: covered, active: inLeg);
    } else {
      runs.add((from: from, to: to, covered: covered, active: inLeg));
    }
  }
  return runs;
}

List<List<double>> _line(Iterable<GeoPoint> points) => [for (final point in points) [point.lon, point.lat]];

Map<String, Object?> _feature(String id, Map<String, Object?> geometry, Map<String, Object?> properties) =>
    {'type': 'Feature', 'id': id, 'geometry': geometry, 'properties': {'id': id, ...properties}};

/// The route as GeoJSON lines: walking runs (`walk`, covered ones `tunnel`, `active` within the
/// highlighted leg), or a car walk's segments (`drive` and `foot`).
Map<String, Object?> routeLineFeatures({
  List<GeoPoint>? geometry,
  List<(int, int)>? tunnels,
  (int, int)? activeLeg,
  List<BuilderSegment> segments = const [],
}) {
  final features = <Map<String, Object?>>[];
  final line = geometry ?? const <GeoPoint>[];
  for (final run in routeRuns(line.length, tunnels ?? const [], activeLeg)) {
    features.add(_feature('route-${features.length}', {'type': 'LineString', 'coordinates': _line(line.sublist(run.from, run.to + 1))}, {
      'kind': run.covered ? 'tunnel' : 'walk',
      'active': run.active,
    }));
  }
  for (final segment in segments) {
    if (segment.geometry.length < 2) continue;
    features.add(_feature('route-${features.length}', {'type': 'LineString', 'coordinates': _line(segment.geometry)}, {
      'kind': segment.driving ? 'drive' : 'foot',
      'active': false,
    }));
  }
  return {'type': 'FeatureCollection', 'features': features};
}

/// Where the camera goes: the points framed whole, or one point centred. A new [key] moves the
/// camera again; the same key keeps the view the walker may have moved since.
@immutable
class MapFit {
  const MapFit(this.key, this.points);

  final String key;
  final List<GeoPoint> points;
}

/// What the walk map shows.
@immutable
class WalkMapView {
  const WalkMapView({
    this.markers = const [],
    this.geometry,
    this.tunnels,
    this.activeLeg,
    this.segments = const [],
    this.selectedId,
    this.user,
    this.fit,
    this.food = const [],
    this.selectedFoodId,
  });

  final List<BuilderMarker> markers;
  final List<GeoPoint>? geometry;
  final List<(int, int)>? tunnels;

  /// Vertex range of the leg to walk now; the rest of the line is dimmed.
  final (int, int)? activeLeg;

  /// A car walk's drives and walks on foot.
  final List<BuilderSegment> segments;
  final String? selectedId;
  final GeoPoint? user;
  final MapFit? fit;

  /// Food places along the route while «Поесть рядом» is open.
  final List<MapMarker> food;
  final String? selectedFoodId;
}

class WalkMapProps {
  const WalkMapProps({required this.view, required this.onSelect, required this.label, this.onFood});

  final WalkMapView view;

  /// A tap on a stop, an end or a parking, by marker id.
  final void Function(String id) onSelect;

  /// A tap on a food place, by its id.
  final void Function(String id)? onFood;

  /// The map's accessible name.
  final String label;
}

typedef WalkMapBuilder = Widget Function(BuildContext context, WalkMapProps props);

final walkRouteMapProvider = Provider<WalkMapBuilder>((ref) => (context, props) => WalkRouteMap(props: props));

String _hex(Color color) => '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

Map<String, Object?> _points(WalkMapView view) => {
      'type': 'FeatureCollection',
      'features': [
        for (final marker in view.markers)
          _feature(marker.id, {'type': 'Point', 'coordinates': [marker.location.lon, marker.location.lat]}, {
            'kind': marker.parking ? 'parking' : marker.endpoint ? 'endpoint' : 'stop',
            'label': marker.number == null ? (marker.parking ? 'P' : '') : '${marker.number}',
            'selected': marker.id == view.selectedId,
          }),
      ],
    };

Map<String, Object?> _food(WalkMapView view) => {
      'type': 'FeatureCollection',
      'features': [
        for (final marker in view.food)
          _feature('food:${marker.id}', {'type': 'Point', 'coordinates': [marker.location.lon, marker.location.lat]}, {
            'food': marker.id,
            'icon': marker.icon,
            'selected': marker.id == view.selectedFoodId,
          }),
      ],
    };

Map<String, Object?> _user(WalkMapView view) => {
      'type': 'FeatureCollection',
      'features': [
        if (view.user case final user?) _feature('user', {'type': 'Point', 'coordinates': [user.lon, user.lat]}, const {}),
      ],
    };

const _routeSource = 'walk-route';
const _pointsSource = 'walk-points';
const _userSource = 'walk-user';
const _foodSource = 'walk-food';
const _pointsLayer = 'walk-points-circle';
const _foodLayer = 'walk-food-icons';

/// The walking line and its covered stretches, by feature kind. A layer update replaces every property, unset ones
/// with the defaults (a black 1 px line), so updates send the same full set the layers start with.
Map<String, LineLayerProperties> routeLineLayers({required bool dimmed}) {
  final route = _hex(TokenColors.routeLine);
  // Without a highlighted leg the whole line is the route; with one, the rest steps back.
  final opacity = ['case', ['==', ['get', 'active'], true], 1, dimmed ? 0.4 : 1];
  return {
    'walk': LineLayerProperties(lineColor: route, lineWidth: 5, lineOpacity: opacity, lineJoin: 'round', lineCap: 'round'),
    'tunnel': LineLayerProperties(lineColor: route, lineWidth: 5, lineOpacity: opacity, lineDasharray: [1.2, 1.2]),
  };
}

class WalkRouteMap extends StatefulWidget {
  const WalkRouteMap({super.key, required this.props});

  final WalkMapProps props;

  @override
  State<WalkRouteMap> createState() => _WalkRouteMapState();
}

class _WalkRouteMapState extends State<WalkRouteMap> {
  MapLibreMapController? _controller;
  bool _styled = false;
  String? _fitted;

  WalkMapView get _view => widget.props.view;

  @override
  void didUpdateWidget(WalkRouteMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(_view, oldWidget.props.view)) unawaited(_draw());
    unawaited(_applyFit());
  }

  Future<void> _addLayers(MapLibreMapController controller) async {
    final view = _view;
    final route = _hex(TokenColors.routeLine);
    final casing = _hex(TokenColors.surfaceIsland);
    final dimmed = view.activeLeg != null;
    await controller.addGeoJsonSource(_routeSource, routeLineFeatures(geometry: view.geometry, tunnels: view.tunnels, activeLeg: view.activeLeg, segments: view.segments));
    await controller.addGeoJsonSource(_pointsSource, _points(view));
    await controller.addGeoJsonSource(_foodSource, _food(view));
    await controller.addGeoJsonSource(_userSource, _user(view));
    // A light casing under every line, as the site's: legible over any basemap.
    await controller.addLineLayer(
      _routeSource,
      'walk-route-casing',
      LineLayerProperties(lineColor: casing, lineWidth: ['match', ['get', 'kind'], 'drive', 10, 9], lineJoin: 'round', lineCap: 'round'),
      enableInteraction: false,
    );
    for (final MapEntry(key: kind, value: properties) in routeLineLayers(dimmed: dimmed).entries) {
      await controller.addLineLayer(_routeSource, 'walk-route-$kind', properties, filter: ['==', ['get', 'kind'], kind], enableInteraction: false);
    }
    await controller.addLineLayer(
      _routeSource,
      'walk-route-drive',
      LineLayerProperties(lineColor: _hex(TokenColors.mapOrange), lineWidth: 6, lineJoin: 'round', lineCap: 'round'),
      filter: ['==', ['get', 'kind'], 'drive'],
      enableInteraction: false,
    );
    await controller.addLineLayer(
      _routeSource,
      'walk-route-foot',
      LineLayerProperties(lineColor: route, lineWidth: 4, lineDasharray: [0.75, 1.5], lineCap: 'round'),
      filter: ['==', ['get', 'kind'], 'foot'],
      enableInteraction: false,
    );
    final selected = ['==', ['get', 'selected'], true];
    // Food under the stops: a stop stays tappable where a place stands next to it (22 px, 36 px selected).
    await controller.addSymbolLayer(
      _foodSource,
      _foodLayer,
      SymbolLayerProperties(iconImage: ['get', 'icon'], iconSize: ['case', selected, 1.5, 0.92], iconAllowOverlap: true, iconIgnorePlacement: true),
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      _pointsSource,
      _pointsLayer,
      CircleLayerProperties(
        circleRadius: ['case', selected, 15, ['match', ['get', 'kind'], 'endpoint', 8, 12]],
        circleColor: ['match', ['get', 'kind'], 'endpoint', casing, 'parking', _hex(TokenColors.focus), ['case', selected, _hex(TokenColors.mapOrange), route]],
        circleStrokeWidth: ['match', ['get', 'kind'], 'endpoint', 4, 2.5],
        circleStrokeColor: ['match', ['get', 'kind'], 'endpoint', route, casing],
      ),
      enableInteraction: false,
    );
    await controller.addSymbolLayer(
      _pointsSource,
      'walk-points-label',
      SymbolLayerProperties(
        textField: ['get', 'label'],
        textFont: const ['noto_sans_regular'],
        textSize: 12,
        textColor: casing,
        textAllowOverlap: true,
        textIgnorePlacement: true,
      ),
      enableInteraction: false,
    );
    final user = _hex(TokenColors.userPosition);
    await controller.addCircleLayer(
      _userSource,
      'walk-user-position',
      CircleLayerProperties(circleRadius: 7, circleColor: user, circleStrokeWidth: 3, circleStrokeColor: casing),
      enableInteraction: false,
    );
  }

  Future<void> _draw() async {
    final controller = _controller;
    if (controller == null || !_styled) return;
    final view = _view;
    try {
      await controller.setGeoJsonSource(_routeSource, routeLineFeatures(geometry: view.geometry, tunnels: view.tunnels, activeLeg: view.activeLeg, segments: view.segments));
      await controller.setGeoJsonSource(_pointsSource, _points(view));
      await controller.setGeoJsonSource(_foodSource, _food(view));
      await controller.setGeoJsonSource(_userSource, _user(view));
      // The dimming depends on whether a leg is highlighted at all.
      final dimmed = view.activeLeg != null;
      for (final MapEntry(key: kind, value: properties) in routeLineLayers(dimmed: dimmed).entries) {
        await controller.setLayerProperties('walk-route-$kind', properties);
      }
    } on PlatformException catch (error) {
      // A source update racing a style reload is redrawn on the next change; the walk keeps working.
      debugPrint('walk map: draw failed: $error');
    }
  }

  Future<void> _applyFit() async {
    final controller = _controller;
    final fit = _view.fit;
    if (controller == null || !_styled || fit == null || fit.points.isEmpty || fit.key == _fitted) return;
    _fitted = fit.key;
    final points = fit.points;
    try {
      final lats = points.map((point) => point.lat), lons = points.map((point) => point.lon);
      final south = lats.reduce(math.min), north = lats.reduce(math.max);
      final west = lons.reduce(math.min), east = lons.reduce(math.max);
      if (south == north && west == east) {
        await controller.animateCamera(CameraUpdate.newLatLngZoom(LatLng(south, west), 16));
        return;
      }
      await controller.animateCamera(CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(south, west), northeast: LatLng(north, east)),
        left: 40,
        top: 40,
        right: 40,
        bottom: 40,
      ));
    } on PlatformException catch (error) {
      debugPrint('walk map: camera failed: $error');
    }
  }

  Future<void> _onStyleLoaded() async {
    final controller = _controller;
    if (controller == null) return;
    try {
      await addMapIcons(controller);
      await _addLayers(controller);
    } on PlatformException catch (error) {
      // Without the overlay the base map still works; the next style load tries again.
      debugPrint('walk map: layers failed: $error');
      return;
    }
    if (!mounted) return;
    _styled = true;
    // The view may have changed while the layers were added.
    await _draw();
    await _applyFit();
  }

  Future<void> _onMapClick(math.Point<double> point, LatLng coordinates) async {
    final controller = _controller;
    if (controller == null || !_styled) return;
    try {
      final hits = await controller.queryRenderedFeatures(point, [_pointsLayer, _foodLayer], null);
      String? food;
      for (final hit in hits) {
        final properties = hit is Map ? hit['properties'] : null;
        if (properties is! Map) continue;
        final id = properties['id'], place = properties['food'];
        // A stop wins over a place drawn under it.
        if (place is String) {
          food ??= place;
        } else if (id is String) {
          widget.props.onSelect(id);
          return;
        }
      }
      final onFood = widget.props.onFood;
      if (food != null && onFood != null) onFood(food);
    } on PlatformException catch (error) {
      debugPrint('walk map: tap lookup failed: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final view = _view;
    final first = view.fit?.points.firstOrNull ?? view.markers.firstOrNull?.location ?? view.geometry?.firstOrNull ?? const GeoPoint(55.7539, 37.6208);
    return Semantics(
      label: widget.props.label,
      child: MapLibreMap(
        styleString: 'assets/map/style.json',
        initialCameraPosition: CameraPosition(target: LatLng(first.lat, first.lon), zoom: 15),
        minMaxZoomPreference: const MinMaxZoomPreference(mapMinZoom, mapMaxZoom),
        rotateGesturesEnabled: false,
        tiltGesturesEnabled: false,
        compassEnabled: false,
        attributionButtonPosition: AttributionButtonPosition.bottomLeft,
        onMapCreated: (controller) => _controller = controller,
        onStyleLoadedCallback: () => unawaited(_onStyleLoaded()),
        onMapClick: (point, coordinates) => unawaited(_onMapClick(point, coordinates)),
      ),
    );
  }
}
