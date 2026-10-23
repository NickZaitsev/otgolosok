// Food places along an open walk (site `use-walk-food.ts`): the cells under the route load while the list is
// open, and the places within 150 m are matched to the route once per change of the cells or the route.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../walk_engine/distance.dart';
import '../../walk_engine/route_legs.dart';
import '../../walk_engine/walk_view.dart' show WalkMode;
import '../explore/cell_store.dart';
import 'food_model.dart';
import 'opening_hours.dart';
import 'route_proximity.dart';

class WalkFood extends ChangeNotifier {
  WalkFood({required this.store, required this.cells}) {
    store.addListener(_changed);
  }

  final CellStore<FoodPlace> store;
  final FoodCells cells;

  /// Shared by the list and the card, so a schedule is parsed once.
  final hours = FoodHoursCache();

  List<GeoPoint> _geometry = const [];
  List<GeoPoint> _stops = const [];
  WalkMode _mode = WalkMode.open;
  List<String> _keys = const [];
  List<double> _vertexDistances = const [];
  List<int> _cuts = const [];
  List<double> _stopsAlongM = const [];
  bool _visible = false;

  /// The manifest keys and route cells last asked for: a failed cell waits for [retry] instead of looping. A newer
  /// manifest with the same cells is the store's business: it refreshes the keys asked for itself.
  Set<String>? _askedKnown;
  List<String>? _askedKeys;
  bool _requestError = false;
  bool _disposed = false;

  List<FoodPlace>? _matchedPoints;
  List<RouteFoodPlace> _places = const [];

  FoodManifest? get manifest => cells.manifest;
  List<GeoPoint> get geometry => _geometry;

  /// The walk has a line and the server has food data: the «Поесть рядом» button shows.
  bool get available => _geometry.length > 1 && store.snapshot.manifestKeys != null && !store.snapshot.maintenance;

  bool get _relevantError => [
        for (final key in _keys)
          if (store.snapshot.manifestKeys?.contains(key) ?? false) key,
      ].any((key) => store.snapshot.cellStatus[key] == CellStatus.error);

  bool get error => _requestError || store.snapshot.manifestStatus == ManifestStatus.error || _relevantError;

  bool get loading {
    final snapshot = store.snapshot;
    final known = snapshot.manifestKeys;
    if (known == null) return true;
    return _keys.any((key) => known.contains(key) && !snapshot.loadedKeys.contains(key) && snapshot.cellStatus[key] != CellStatus.error);
  }

  /// The manifest itself failed: the walk says so under its tools, as the button cannot show.
  bool get manifestError => _geometry.length > 1 && error && store.snapshot.manifestKeys == null && !store.snapshot.maintenance;

  /// The places within 150 m of the route, ordered along it.
  List<RouteFoodPlace> get places {
    final points = store.snapshot.points;
    if (!identical(points, _matchedPoints)) {
      _matchedPoints = points;
      _places = _geometry.length < 2 ? const [] : placesAlongRoute(points, _geometry, mode: _mode);
    }
    return _places;
  }

  /// The stops' distances along the route, for «У остановки N».
  List<double> get stopsAlongM => _stopsAlongM;

  /// Where the leg [leg] starts along the route: during the walk the places before it are behind.
  double fromM(int leg) {
    if (_vertexDistances.isEmpty) return 0;
    final vertex = leg <= 0 || _cuts.isEmpty ? 0 : _cuts[(leg - 1).clamp(0, _cuts.length - 1)];
    return _vertexDistances[vertex.clamp(0, _vertexDistances.length - 1)];
  }

  /// The point of the route the place is matched to, framed with it.
  GeoPoint? routePoint(RouteFoodPlace place) => matchedRoutePoint(place.match, _geometry, _vertexDistances);

  /// A new route (the walk changed or turned round); the same lists keep everything as it is.
  void setRoute(List<GeoPoint> geometry, List<GeoPoint> stops, WalkMode mode) {
    if (identical(geometry, _geometry) && listEquals(stops, _stops) && mode == _mode) return;
    final newLine = !identical(geometry, _geometry) || mode != _mode;
    _geometry = geometry;
    _stops = stops;
    _mode = mode;
    if (newLine) {
      _keys = cellsForRoute(geometry);
      _vertexDistances = routeVertexDistances(geometry);
      _matchedPoints = null;
    }
    _cuts = routeLegCuts(geometry, stops);
    _stopsAlongM = [for (final stop in stops) distanceToRoute(stop, geometry, mode: mode).alongM];
    if (geometry.length > 1) unawaited(_guard(store.ensureManifest()));
    _load();
  }

  /// The list opened or closed: the cells load only while it is open.
  void setVisible(bool visible) {
    if (visible == _visible) return;
    _visible = visible;
    _load();
  }

  void _load() {
    final known = store.snapshot.manifestKeys;
    if (!_visible || known == null || store.snapshot.maintenance) return;
    if (identical(_askedKeys, _keys) && setEquals(_askedKnown, known)) return;
    _askedKnown = known;
    _askedKeys = _keys;
    unawaited(_guard(store.ensureKeys(_keys)));
  }

  Future<void> retry() async {
    _requestError = false;
    _askedKeys = null;
    _changed();
    await _guard(store.revalidate());
    if (_visible) await _guard(store.ensureKeys(_keys));
  }

  /// The store reports its own failures in the snapshot; anything thrown past it is still an error to show.
  Future<void> _guard(Future<void> task) async {
    try {
      await task;
    } on Object catch (error) {
      debugPrint('Walk food failed: ${error.runtimeType}');
      _requestError = true;
      _changed();
    }
  }

  void _changed() {
    if (_disposed) return;
    // A manifest that arrived while the list is open loads the cells under the route.
    _load();
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    store.removeListener(_changed);
    super.dispose();
  }
}
