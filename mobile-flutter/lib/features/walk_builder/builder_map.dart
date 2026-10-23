// The builder map: the start, stops and finish, the built route and, for car walks, parking. The
// MapLibre widget sits behind [builderMapProvider] so widget tests draw a plain stand-in.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../app/theme/tokens.g.dart';
import '../../walk_engine/car_route.dart';
import '../../walk_engine/distance.dart';
import '../explore/catalog_bounds.dart';
import '../walks/route_map.dart' show routeLineFeatures;
import 'model.dart';

@immutable
class BuilderMarker {
  const BuilderMarker({required this.id, required this.title, required this.location, this.number, this.endpoint = false, this.parking = false});

  final String id;
  final String title;
  final GeoPoint location;
  final int? number;
  final bool endpoint;
  final bool parking;
}

/// One stretch of a car walk: driven or walked.
typedef BuilderSegment = ({bool driving, List<GeoPoint> geometry});

/// What the map shows.
@immutable
class BuilderMapView {
  const BuilderMapView({
    this.markers = const [],
    this.geometry,
    this.segments = const [],
    this.tunnels,
    this.focus,
    this.picking = false,
    this.parking = const [],
  });

  final List<BuilderMarker> markers;

  /// The walking route.
  final List<GeoPoint>? geometry;

  /// The car route, by segment.
  final List<BuilderSegment> segments;
  final List<(int, int)>? tunnels;
  final GeoPoint? focus;

  /// Waiting for a tap that chooses a point.
  final bool picking;

  /// The parking layer around the view.
  final List<ParkingPlace> parking;
}

/// The map's inputs and callbacks.
class BuilderMapProps {
  const BuilderMapProps({required this.view, required this.onTap, required this.onViewport});

  final BuilderMapView view;
  final void Function(GeoPoint point) onTap;
  final void Function(MapViewport viewport) onViewport;
}

typedef BuilderMapBuilder = Widget Function(BuildContext context, BuilderMapProps props);

final builderMapProvider = Provider<BuilderMapBuilder>((ref) => (context, props) => BuilderMap(props: props));

const _moscow = GeoPoint(55.7539, 37.6208);

String _hex(Color color) => '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

Map<String, Object?> _feature(String id, Map<String, Object?> geometry, Map<String, Object?> properties) =>
    {'type': 'Feature', 'id': id, 'geometry': geometry, 'properties': properties};

/// The route as GeoJSON lines; covered stretches of a walking route are marked `tunnel`.
@visibleForTesting
Map<String, Object?> routeFeatures(BuilderMapView view) =>
    routeLineFeatures(geometry: view.geometry, tunnels: view.tunnels, segments: view.segments);

Map<String, Object?> _points(BuilderMapView view) => {
      'type': 'FeatureCollection',
      'features': [
        for (final marker in view.markers)
          _feature(marker.id, {'type': 'Point', 'coordinates': [marker.location.lon, marker.location.lat]}, {
            'kind': marker.parking ? 'parking' : marker.endpoint ? 'endpoint' : 'stop',
            'label': marker.number == null ? (marker.parking ? 'P' : '') : '${marker.number}',
          }),
        for (final place in view.parking)
          _feature('parking:${place.id}', {'type': 'Point', 'coordinates': [place.location.lon, place.location.lat]}, {'kind': 'parking-layer', 'label': 'P'}),
      ],
    };

class BuilderMap extends StatefulWidget {
  const BuilderMap({super.key, required this.props});

  final BuilderMapProps props;

  @override
  State<BuilderMap> createState() => _BuilderMapState();
}

class _BuilderMapState extends State<BuilderMap> {
  MapLibreMapController? _controller;
  bool _styled = false;

  @override
  void didUpdateWidget(BuilderMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final view = widget.props.view, old = oldWidget.props.view;
    if (!identical(view, old)) unawaited(_draw());
    final focus = view.focus;
    if (focus != null && focus != old.focus) unawaited(_controller?.animateCamera(CameraUpdate.newLatLngZoom(LatLng(focus.lat, focus.lon), 15)));
  }

  Future<void> _addLayers(MapLibreMapController controller) async {
    final view = widget.props.view;
    await controller.addGeoJsonSource('builder-route', routeFeatures(view));
    await controller.addGeoJsonSource('builder-points', _points(view));
    final route = _hex(TokenColors.routeLine);
    await controller.addLineLayer(
      'builder-route',
      'builder-route-line',
      LineLayerProperties(lineColor: route, lineWidth: 5, lineOpacity: 0.9, lineJoin: 'round', lineCap: 'round'),
      filter: ['in', ['get', 'kind'], ['literal', ['walk', 'foot']]],
      enableInteraction: false,
    );
    await controller.addLineLayer(
      'builder-route',
      'builder-route-drive',
      LineLayerProperties(lineColor: _hex(TokenColors.mapOrange), lineWidth: 6, lineJoin: 'round', lineCap: 'round'),
      filter: ['==', ['get', 'kind'], 'drive'],
      enableInteraction: false,
    );
    await controller.addLineLayer(
      'builder-route',
      'builder-route-tunnel',
      LineLayerProperties(lineColor: route, lineWidth: 4, lineOpacity: 0.6, lineDasharray: [1.5, 1.5]),
      filter: ['==', ['get', 'kind'], 'tunnel'],
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      'builder-points',
      'builder-parking-layer',
      CircleLayerProperties(circleRadius: 9, circleColor: _hex(TokenColors.focus), circleOpacity: 0.75, circleStrokeWidth: 1.5, circleStrokeColor: '#ffffff'),
      filter: ['==', ['get', 'kind'], 'parking-layer'],
      minzoom: 14,
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      'builder-points',
      'builder-points-circle',
      CircleLayerProperties(
        circleRadius: ['match', ['get', 'kind'], 'endpoint', 9, 12],
        circleColor: ['match', ['get', 'kind'], 'endpoint', '#ffffff', 'parking', _hex(TokenColors.focus), route],
        circleStrokeWidth: ['match', ['get', 'kind'], 'endpoint', 4, 2],
        circleStrokeColor: ['match', ['get', 'kind'], 'endpoint', route, '#ffffff'],
      ),
      filter: ['!=', ['get', 'kind'], 'parking-layer'],
      enableInteraction: false,
    );
    await controller.addSymbolLayer(
      'builder-points',
      'builder-points-label',
      SymbolLayerProperties(
        textField: ['get', 'label'],
        textFont: ['noto_sans_regular'],
        textSize: 12,
        textColor: '#ffffff',
        textAllowOverlap: true,
        textIgnorePlacement: true,
      ),
      enableInteraction: false,
    );
  }

  Future<void> _draw() async {
    final controller = _controller;
    if (controller == null || !_styled) return;
    try {
      await controller.setGeoJsonSource('builder-route', routeFeatures(widget.props.view));
      await controller.setGeoJsonSource('builder-points', _points(widget.props.view));
    } catch (error) {
      // A source update racing a style reload is redrawn on the next change; the form keeps working.
      debugPrint('builder map: draw failed: $error');
    }
  }

  Future<void> _onStyleLoaded() async {
    final controller = _controller;
    if (controller == null) return;
    try {
      await _addLayers(controller);
      _styled = true;
    } catch (error) {
      debugPrint('builder map: layers failed: $error');
    }
  }

  Future<void> _onCameraIdle() async {
    final controller = _controller;
    final camera = controller?.cameraPosition;
    if (controller == null || camera == null || !mounted) return;
    final size = context.size;
    if (size == null) return;
    widget.props.onViewport(viewportFor(
      center: GeoPoint(camera.target.latitude, camera.target.longitude),
      zoom: camera.zoom,
      width: size.width,
      height: size.height,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final focus = widget.props.view.focus ?? _moscow;
    return MapLibreMap(
      styleString: 'assets/map/style.json',
      initialCameraPosition: CameraPosition(target: LatLng(focus.lat, focus.lon), zoom: widget.props.view.focus == null ? 11 : 15),
      minMaxZoomPreference: const MinMaxZoomPreference(mapMinZoom, 19),
      trackCameraPosition: true,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      onMapCreated: (controller) => _controller = controller,
      onStyleLoadedCallback: () => unawaited(_onStyleLoaded()),
      onMapClick: (point, coordinates) => widget.props.onTap(GeoPoint(coordinates.latitude, coordinates.longitude)),
      onCameraIdle: () => unawaited(_onCameraIdle()),
    );
  }
}

/// The markers of [draft] as the walk session draws them: rings for the ends, numbers for stops.
List<BuilderMarker> draftMarkers(Draft draft, String Function(String source, Map<String, Object> values) t) {
  final start = draft.start, destination = draft.destination;
  return [
    if (start != null) BuilderMarker(id: 'creation-start', title: t('Старт: {address}', {'address': start.address}), location: start.location, endpoint: true),
    for (var index = 0; index < draft.stops.length; index++)
      BuilderMarker(
        id: 'creation-stop-$index',
        title: t('Остановка {number}: {address}', {'number': index + 1, 'address': draft.stops[index].address}),
        location: draft.stops[index].location,
        number: index + 1,
      ),
    if (destination != null)
      BuilderMarker(id: 'creation-finish', title: t('Финиш: {address}', {'address': destination.address}), location: destination.location, endpoint: true),
    for (final visit in draft.route?.car?.visits ?? const <ParkingVisit>[])
      BuilderMarker(id: 'parking:${visit.parking.id}', title: visit.parking.name, location: visit.parking.location, parking: true),
  ];
}
