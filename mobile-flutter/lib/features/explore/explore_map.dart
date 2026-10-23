/// The MapLibre map of the explore screen: the bundled style, story pins and groups, walk overview lines
/// and the user's position. State lives in the screen; this widget draws it and reports taps and the view.
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../app/theme/tokens.g.dart';
import '../../walk_engine/distance.dart';
import 'catalog_bounds.dart';
import 'map_clusters.dart';
import 'map_layers.dart';
import 'map_location_source.dart';
import 'walk_overview.dart';

const _styleAsset = 'assets/map/style.json';

/// The POI icons the bundled style references (there is no sprite: the app adds them as images).
const _styleIcons = [
  'poi-church', 'poi-orthodox', 'poi-synagogue', 'poi-mosque', 'poi-theatre', 'poi-viewpoint', //
  'poi-monument', 'poi-memorial', 'poi-toilets', 'poi-water', 'poi-station',
];

/// Leaflet z19 of the site is MapLibre z18.
const double mapMaxZoom = 18;

String _hex(Color color) => '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

class ExploreMap extends StatefulWidget {
  const ExploreMap({
    super.key,
    required this.initialCenter,
    required this.initialZoom,
    required this.clusters,
    required this.walks,
    required this.locationSource,
    required this.onViewport,
    required this.onClusterTap,
    required this.onWalksTap,
    required this.onMapTap,
    this.selectedPlaceId,
    this.selectedWalks = const {},
    this.userPosition,
    this.userAccuracyM,
    this.padding = EdgeInsets.zero,
  });

  final GeoPoint initialCenter;
  final double initialZoom;
  final List<MapCluster> clusters;
  final String? selectedPlaceId;
  final List<MapWalk> walks;
  final Set<String> selectedWalks;

  /// The settled position drawn by the app; while locating, the map's own puck shows the engine's fixes.
  final GeoPoint? userPosition;
  final double? userAccuracyM;
  final MapFixSource locationSource;

  /// Space covered by sheets and controls, kept clear when the camera fits or focuses something.
  final EdgeInsets padding;
  final ValueChanged<MapViewport> onViewport;
  final ValueChanged<MapCluster> onClusterTap;
  final ValueChanged<List<String>> onWalksTap;
  final ValueChanged<GeoPoint> onMapTap;

  @override
  State<ExploreMap> createState() => ExploreMapState();
}

class ExploreMapState extends State<ExploreMap> {
  MapLibreMapController? _controller;
  var _styleReady = false;
  Size _size = Size.zero;

  /// Source updates go out one at a time, the latest data winning, so a slow platform call never lands late.
  final _dirty = <String>{};
  var _flushing = false;

  @override
  void initState() {
    super.initState();
    widget.locationSource.addListener(_locationChanged);
  }

  @override
  void didUpdateWidget(ExploreMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.locationSource, widget.locationSource)) {
      oldWidget.locationSource.removeListener(_locationChanged);
      widget.locationSource.addListener(_locationChanged);
    }
    if (!identical(oldWidget.clusters, widget.clusters) || oldWidget.selectedPlaceId != widget.selectedPlaceId) _mark(placesSourceId);
    if (!identical(oldWidget.walks, widget.walks) || !setEquals(oldWidget.selectedWalks, widget.selectedWalks)) _mark(walksSourceId);
    if (oldWidget.userPosition != widget.userPosition || oldWidget.userAccuracyM != widget.userAccuracyM) _mark(userSourceId);
  }

  @override
  void dispose() {
    widget.locationSource.removeListener(_locationChanged);
    super.dispose();
  }

  void _locationChanged() {
    if (mounted) setState(() {});
  }

  Map<String, Object?> _data(String source) => switch (source) {
        placesSourceId => placesGeoJson(widget.clusters, selectedId: widget.selectedPlaceId),
        walksSourceId => walksGeoJson(widget.walks, selected: widget.selectedWalks),
        _ => userGeoJson(widget.userPosition, widget.userAccuracyM),
      };

  void _mark(String source) {
    _dirty.add(source);
    unawaited(_flush());
  }

  Future<void> _flush() async {
    final controller = _controller;
    if (_flushing || !_styleReady || controller == null) return;
    _flushing = true;
    try {
      while (_dirty.isNotEmpty && mounted) {
        final source = _dirty.first;
        _dirty.remove(source);
        try {
          await controller.setGeoJsonSource(source, _data(source));
        } on PlatformException catch (error) {
          debugPrint('Map source $source failed to update: $error');
        }
      }
    } finally {
      _flushing = false;
    }
  }

  Future<void> _onStyleLoaded() async {
    final controller = _controller;
    if (controller == null) return;
    try {
      await _addIcons(controller);
      await controller.addGeoJsonSource(walksSourceId, _data(walksSourceId));
      await controller.addGeoJsonSource(userSourceId, _data(userSourceId));
      await controller.addGeoJsonSource(placesSourceId, _data(placesSourceId));
      await _addLayers(controller);
    } on PlatformException catch (error) {
      // Without the overlay the base map still works; the next style load tries again.
      debugPrint('Map overlay failed to load: $error');
      return;
    }
    if (!mounted) return;
    _styleReady = true;
    _dirty.addAll(const [placesSourceId, walksSourceId, userSourceId]);
    await _flush();
    _reportViewport();
  }

  /// The icons are added at their 1x size: the plugin's `addImage` takes no pixel ratio, so a 2x/3x
  /// bitmap would be drawn two or three times too large.
  Future<void> _addIcons(MapLibreMapController controller) async {
    for (final name in _styleIcons) {
      try {
        final data = await rootBundle.load('assets/map/icons/$name.png');
        await controller.addImage(name, data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
      } on Object catch (error) {
        debugPrint('Map icon $name failed to load: $error');
      }
    }
  }

  Future<void> _addLayers(MapLibreMapController controller) async {
    final island = _hex(TokenColors.surfaceIsland);
    final orange = _hex(TokenColors.mapOrange);
    final colors = [
      TokenColors.walkOverview1, TokenColors.walkOverview2, TokenColors.walkOverview3, //
      TokenColors.walkOverview4, TokenColors.walkOverview5, TokenColors.walkOverview6,
    ];
    final walkColor = [
      'match', ['get', 'color'],
      for (var index = 0; index < colors.length; index++) ...[index + 1, _hex(colors[index])],
      _hex(TokenColors.routeLine),
    ];
    await controller.addLineLayer(
      walksSourceId,
      'otg-walks-line',
      LineLayerProperties(lineColor: walkColor, lineWidth: 4, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round'),
      enableInteraction: false,
    );
    await controller.addLineLayer(
      walksSourceId,
      'otg-walks-selected',
      LineLayerProperties(lineColor: walkColor, lineWidth: 8, lineCap: 'round', lineJoin: 'round'),
      filter: ['==', ['get', 'selected'], true],
      enableInteraction: false,
    );
    final user = _hex(TokenColors.userPosition);
    await controller.addFillLayer(
      userSourceId,
      'otg-user-accuracy',
      FillLayerProperties(fillColor: user, fillOpacity: 0.14, fillOutlineColor: user),
      filter: ['==', ['get', 'kind'], 'accuracy'],
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      userSourceId,
      'otg-user-position',
      CircleLayerProperties(circleRadius: 7, circleColor: user, circleStrokeWidth: 3, circleStrokeColor: island),
      filter: ['==', ['get', 'kind'], 'position'],
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      placesSourceId,
      'otg-places-cluster',
      CircleLayerProperties(circleRadius: 17, circleColor: orange, circleStrokeWidth: 2, circleStrokeColor: island),
      filter: ['==', ['get', 'kind'], 'cluster'],
      enableInteraction: false,
    );
    await controller.addSymbolLayer(
      placesSourceId,
      'otg-places-cluster-count',
      SymbolLayerProperties(
        textField: ['to-string', ['get', 'count']],
        textFont: const ['noto_sans_regular'],
        textSize: TokenSizes.textMapCluster,
        textColor: island,
        textAllowOverlap: true,
        textIgnorePlacement: true,
      ),
      filter: ['==', ['get', 'kind'], 'cluster'],
      enableInteraction: false,
    );
    // 24 px pins with a 3 px light ring (site `.storyPin`), 32 px for the selected one.
    await controller.addCircleLayer(
      placesSourceId,
      'otg-places-pin',
      CircleLayerProperties(
        circleRadius: ['case', ['==', ['get', 'selected'], true], 13, 9],
        circleColor: orange,
        circleStrokeWidth: 3,
        circleStrokeColor: island,
      ),
      filter: ['==', ['get', 'kind'], 'pin'],
      enableInteraction: false,
    );
  }

  CameraPosition? get _camera => _controller?.cameraPosition;

  void _reportViewport() {
    final camera = _camera;
    if (camera == null || _size.isEmpty) return;
    widget.onViewport(viewportFor(
      center: GeoPoint(camera.target.latitude, camera.target.longitude),
      zoom: camera.zoom,
      width: _size.width,
      height: _size.height,
    ));
  }

  void _onMapClick(math.Point<double> point, LatLng coordinates) {
    final zoom = _camera?.zoom;
    final tap = GeoPoint(coordinates.latitude, coordinates.longitude);
    if (zoom == null) {
      widget.onMapTap(tap);
      return;
    }
    final cluster = clusterAt(tap, widget.clusters, zoom);
    if (cluster != null) {
      widget.onClusterTap(cluster);
      return;
    }
    if (widget.walks.isNotEmpty) {
      final hits = walksAt(tap, widget.walks, zoom);
      if (hits.isNotEmpty) {
        widget.onWalksTap(hits);
        return;
      }
    }
    widget.onMapTap(tap);
  }

  /// Centres [point], zooming in to [zoom] when given.
  Future<void> focus(GeoPoint point, {double? zoom}) async {
    final controller = _controller;
    if (controller == null) return;
    final target = LatLng(point.lat, point.lon);
    try {
      await controller.animateCamera(zoom == null ? CameraUpdate.newLatLng(target) : CameraUpdate.newLatLngZoom(target, zoom));
    } on PlatformException catch (error) {
      debugPrint('Map camera failed: $error');
    }
  }

  /// Shows [bounds] whole, clear of the sheet and controls.
  Future<void> fit(CatalogBounds bounds, {double maxZoom = mapMaxZoom}) async {
    final controller = _controller;
    if (controller == null) return;
    // A single point (or a group stacked on one spot) has no extent: centre it at the deepest zoom instead.
    if (bounds.west == bounds.east && bounds.south == bounds.north) {
      return focus(GeoPoint(bounds.south, bounds.west), zoom: maxZoom);
    }
    final padding = widget.padding;
    try {
      await controller.animateCamera(CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(bounds.south, bounds.west), northeast: LatLng(bounds.north, bounds.east)),
        left: padding.left + 48,
        top: padding.top + 48,
        right: padding.right + 48,
        bottom: padding.bottom + 48,
      ));
    } on PlatformException catch (error) {
      debugPrint('Map camera failed: $error');
    }
  }

  double? get zoom => _camera?.zoom;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
        final size = constraints.biggest;
        if (size != _size) {
          _size = size;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _reportViewport();
          });
        }
        return MapLibreMap(
          styleString: _styleAsset,
          initialCameraPosition: CameraPosition(target: LatLng(widget.initialCenter.lat, widget.initialCenter.lon), zoom: widget.initialZoom),
          minMaxZoomPreference: const MinMaxZoomPreference(mapMinZoom, mapMaxZoom),
          trackCameraPosition: true,
          rotateGesturesEnabled: false,
          tiltGesturesEnabled: false,
          compassEnabled: false,
          attributionButtonPosition: AttributionButtonPosition.bottomLeft,
          attributionButtonMargins: math.Point(TokenSizes.spaceXs, widget.padding.bottom + TokenSizes.spaceXs),
          // The engine runs only during a locate run; the settled position is the app's own dot.
          myLocationEnabled: widget.locationSource.active,
          onUserLocationUpdated: (location) => widget.locationSource.deliver(MapLocationUpdate(
            lat: location.position.latitude,
            lon: location.position.longitude,
            accuracyM: location.horizontalAccuracy,
            timestamp: location.timestamp,
          )),
          onMapCreated: (controller) => _controller = controller,
          onStyleLoadedCallback: () => unawaited(_onStyleLoaded()),
          onCameraIdle: _reportViewport,
          onMapClick: _onMapClick,
        );
      });
}
