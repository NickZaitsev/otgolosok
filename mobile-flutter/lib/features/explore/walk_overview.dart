/// Public walks drawn as overview lines on the explore map (port of `src/features/explore/walk-overview.ts`).
library;

import 'dart:math' as math;

import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/cities.dart';
import '../../walk_engine/json_read.dart';
import '../reviews/review_model.dart';
import '../walks/format.dart';
import '../walks/top_model.dart';
import 'catalog_bounds.dart';

const walkOverviewPath = '/api/walks/map';
const walkOverviewToggleKey = 'otgolosok:around:walks:v1';

/// Loaded areas are trusted this long; after that a view inside them asks the server again.
const walkOverviewTtl = Duration(minutes: 10);

/// How close to a line a tap still selects it, in logical pixels: a finger, not a cursor.
const double walkHitTolerancePx = 16;

/// Colours of the overview lines (`walkOverview1..6` tokens).
const walkOverviewColors = 6;

const double _grid = 0.01;
const _areaHistory = 8;

/// A public walk drawn as an overview line; [key] is unique across kinds.
@immutable
class MapWalk {
  const MapWalk({
    required this.kind,
    required this.id,
    required this.title,
    required this.walkingMinutes,
    required this.distanceM,
    required this.stopCount,
    required this.rating,
    required this.line,
    required this.bounds,
    this.driving = false,
    this.totalMinutes,
  });

  final TopWalkKind kind;
  final String id;
  final String title;
  final bool driving;
  final double? totalMinutes;
  final double walkingMinutes;
  final double distanceM;
  final int stopCount;
  final ReviewSummary rating;

  /// `[lat, lon]` pairs.
  final List<(double, double)> line;
  final CatalogBounds bounds;

  String get key => '${kind.name}:$id';

  /// `/walk?catalog=…` or `/walk?share=…` (site `topWalkHref`).
  String get location => Uri(path: '/walk', queryParameters: {kind == TopWalkKind.catalog ? 'catalog' : 'share': id}).toString();
}

MapWalk _validateMapWalk(Object? raw) {
  final item = readMap(raw);
  final kind = switch (item['kind']) {
    'catalog' => TopWalkKind.catalog,
    'shared' => TopWalkKind.shared,
    _ => failFormat('Неверный вид прогулки.'),
  };
  final id = item['id'];
  if (id is! String || !(kind == TopWalkKind.catalog ? catalogWalkId : walkUuid).hasMatch(id)) {
    failFormat('Неверный идентификатор прогулки.');
  }
  final rawLine = item['line'];
  if (rawLine is! List<Object?> || rawLine.length < 2 || rawLine.length > 20000) failFormat('Неверная линия прогулки.');
  final line = <(double, double)>[];
  var south = 90.0, north = -90.0, west = 180.0, east = -180.0;
  for (final point in rawLine) {
    if (point is! List<Object?> || point.length != 2) failFormat('Неверная линия прогулки.');
    final lat = point[0], lon = point[1];
    if (lat is! num || !lat.isFinite || lat.abs() > 90 || lon is! num || !lon.isFinite || lon.abs() > 180) {
      failFormat('Неверная линия прогулки.');
    }
    final la = lat.toDouble(), lo = lon.toDouble();
    line.add((la, lo));
    south = math.min(south, la);
    north = math.max(north, la);
    west = math.min(west, lo);
    east = math.max(east, lo);
  }
  final card = validateWalkCard(item);
  return MapWalk(
    kind: kind,
    id: id,
    title: card.title,
    driving: card.driving,
    totalMinutes: card.totalMinutes,
    walkingMinutes: card.walkingMinutes,
    distanceM: card.distanceM,
    stopCount: card.stopCount,
    rating: card.rating,
    line: List.unmodifiable(line),
    bounds: CatalogBounds(west: west, south: south, east: east, north: north),
  );
}

/// `complete` is false when the server's limit cut the list (an older server never cuts it).
({List<MapWalk> walks, bool complete}) validateMapWalks(Object? value) {
  final body = readMap(value);
  final walks = body['walks'];
  if (walks is! List<Object?>) failFormat('Ожидался список прогулок.');
  final complete = body['complete'];
  if (body.containsKey('complete') && complete is! bool) failFormat('Неверный признак полноты.');
  return (walks: [for (final walk in walks) _validateMapWalk(walk)], complete: complete != false);
}

/// A stable colour per walk (1-based token index), so a walk keeps its colour across visits.
int walkColorIndex(String key) {
  var hash = 0;
  for (final unit in key.codeUnits) {
    hash = (hash * 31 + unit).toSigned(32);
  }
  return hash.abs() % walkOverviewColors + 1;
}

/// «45 мин · 3,2 км · 6 историй» of a map walk (site `formatTopWalkMeta`).
String formatMapWalkMeta(MapWalk walk, AppLocale locale, String Function(String source, Map<String, Object> values) t) {
  final values = <String, Object>{
    'minutes': jsRound(walk.totalMinutes ?? walk.walkingMinutes),
    'distance': formatFixed(walk.distanceM / 1000, locale),
    'stories': storyCountLabel(walk.stopCount, locale, t),
  };
  return walk.driving ? t('На машине · {minutes} мин · {distance} км · {stories}', values) : t('{minutes} мин · {distance} км · {stories}', values);
}

double _mercatorY(double lat) => math.log(math.tan(math.pi / 4 + lat * math.pi / 360));
double _latitude(double y) => (2 * math.atan(math.exp(y)) - math.pi / 2) * 180 / math.pi;
double _fixed(double value) => double.parse(value.toStringAsFixed(2));

/// The area to load for a view: twice the visible width and height (the required bounds already carry
/// half a zoom step, √2), snapped outward to 0.01° and clipped to the catalog region of its centre;
/// null when the centre is outside every city.
CatalogBounds? overviewArea(CatalogBounds required) {
  const scale = math.sqrt2;
  final halfX = (required.east - required.west) / 2 * scale, midX = (required.east + required.west) / 2;
  final top = _mercatorY(math.min(85, required.north)), bottom = _mercatorY(math.max(-85, required.south));
  final halfY = (top - bottom) / 2 * scale, midY = (top + bottom) / 2;
  final region = regionCityAt(_latitude(midY), midX)?.region;
  if (region == null) return null;
  final west = math.max(region.west, ((midX - halfX) / _grid).floor() * _grid);
  final east = math.min(region.east, ((midX + halfX) / _grid).ceil() * _grid);
  final south = math.max(region.south, (_latitude(midY - halfY) / _grid).floor() * _grid);
  final north = math.min(region.north, (_latitude(midY + halfY) / _grid).ceil() * _grid);
  if (west >= east || south >= north) return null;
  // Snapping in floating point leaves tails like 37.580000000000005; the server takes six decimals.
  return CatalogBounds(west: _fixed(west), south: _fixed(south), east: _fixed(east), north: _fixed(north));
}

Map<String, String> overviewQuery(CatalogBounds area) => {
      'west': area.west.toStringAsFixed(2),
      'south': area.south.toStringAsFixed(2),
      'east': area.east.toStringAsFixed(2),
      'north': area.north.toStringAsFixed(2),
    };

double _segmentDistance(math.Point<double> p, math.Point<double> a, math.Point<double> b) {
  final dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  final ratio = lengthSquared == 0 ? 0.0 : (((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared).clamp(0.0, 1.0);
  final ex = p.x - a.x - ratio * dx, ey = p.y - a.y - ratio * dy;
  return math.sqrt(ex * ex + ey * ey);
}

/// Lines passing within [tolerance] of a tap, nearest first: overlapping walks are all offered.
List<String> walksAtPoint(math.Point<double> point, List<({String key, List<math.Point<double>> pixels})> lines,
    {double tolerance = walkHitTolerancePx}) {
  final hits = <({String key, double nearest})>[];
  for (final line in lines) {
    var nearest = double.infinity;
    for (var index = 1; index < line.pixels.length; index++) {
      nearest = math.min(nearest, _segmentDistance(point, line.pixels[index - 1], line.pixels[index]));
    }
    if (nearest <= tolerance) hits.add((key: line.key, nearest: nearest));
  }
  hits.sort((a, b) {
    final byDistance = a.nearest.compareTo(b.nearest);
    return byDistance != 0 ? byDistance : a.key.compareTo(b.key);
  });
  return [for (final hit in hits) hit.key];
}

enum WalkOverviewStatus { idle, loading, ready, error }

@immutable
class WalkOverviewSnapshot {
  const WalkOverviewSnapshot({this.walks = const [], this.status = WalkOverviewStatus.idle, this.unavailable = false});

  /// Every loaded walk, in the server's ranking order of first arrival.
  final List<MapWalk> walks;
  final WalkOverviewStatus status;

  /// The server has no walk store (503 UNAVAILABLE): the layer is switched off rather than retried.
  final bool unavailable;

  WalkOverviewSnapshot copyWith({List<MapWalk>? walks, WalkOverviewStatus? status, bool? unavailable}) =>
      WalkOverviewSnapshot(walks: walks ?? this.walks, status: status ?? this.status, unavailable: unavailable ?? this.unavailable);
}

typedef WalkOverviewFetch = Future<({List<MapWalk> walks, bool complete})> Function(CatalogBounds area, CancelToken cancel);

WalkOverviewFetch apiWalkOverviewFetch(ApiClient api) =>
    (area, cancel) => api.get(walkOverviewPath, validateMapWalks, query: overviewQuery(area), cancel: cancel);

class _Area {
  const _Area(this.bounds, this.at, this.complete);
  final CatalogBounds bounds;
  final DateTime at;

  /// An incomplete area (cut by the server's limit) only spares repeating its own request.
  final bool complete;
}

/// Overview walks loaded by area and kept for the session: a view already covered by a fresh loaded area
/// makes no request, a new one loads twice the view. Walks are merged by key; a complete answer for an
/// area also drops walks that left it (unpublished or moved).
class WalkOverviewStore extends ChangeNotifier {
  WalkOverviewStore({required this._fetch, DateTime Function()? now})
      : _now = now ?? DateTime.now;

  final WalkOverviewFetch _fetch;
  final DateTime Function() _now;
  final _walks = <String, MapWalk>{};
  var _areas = <_Area>[];
  ({CatalogBounds area, CancelToken cancel, Future<void> done})? _inflight;
  CatalogBounds? _last;
  var _snapshot = const WalkOverviewSnapshot();
  var _disposed = false;

  WalkOverviewSnapshot get snapshot => _snapshot;

  void _publish(WalkOverviewSnapshot next) {
    _snapshot = next;
    if (!_disposed) notifyListeners();
  }

  bool _fresh(_Area area) => _now().difference(area.at) < walkOverviewTtl;
  bool _covered(CatalogBounds view) => _areas.any((area) => area.complete && _fresh(area) && area.bounds.contains(view));
  bool _requested(CatalogBounds bounds) => _areas.any((area) => _fresh(area) && area.bounds == bounds);

  Future<void> _load(CatalogBounds area) {
    final current = _inflight;
    if (current != null && current.area == area) return current.done;
    // Only the latest view matters: a fast pan cancels the request for the area it left.
    current?.cancel.cancel();
    final cancel = CancelToken();
    _last = area;
    _publish(_snapshot.copyWith(status: WalkOverviewStatus.loading));
    final done = _run(area, cancel);
    _inflight = (area: area, cancel: cancel, done: done);
    return done;
  }

  Future<void> _run(CatalogBounds area, CancelToken cancel) async {
    try {
      final answer = await _fetch(area, cancel);
      if (cancel.isCancelled || _disposed) return;
      // Only a full answer proves that a missing walk left the area; a cut one may have skipped it.
      if (answer.complete) {
        final present = {for (final walk in answer.walks) walk.key};
        _walks.removeWhere((key, walk) => !present.contains(key) && walk.bounds.intersects(area));
      }
      for (final walk in answer.walks) {
        _walks[walk.key] = walk;
      }
      final kept = _areas.where((known) => !(answer.complete ? area.contains(known.bounds) : area == known.bounds));
      final areas = [...kept, _Area(area, _now(), answer.complete)];
      _areas = areas.length > _areaHistory ? areas.sublist(areas.length - _areaHistory) : areas;
      _publish(WalkOverviewSnapshot(walks: List.unmodifiable(_walks.values), status: WalkOverviewStatus.ready));
    } on Object catch (error) {
      if (cancel.isCancelled || _disposed) return;
      if (error is! ApiError && error is! FormatException) debugPrint('Walk overview failed: $error');
      // Only a server without the walk store turns the layer off; maintenance and other 503s can be retried.
      final unavailable = error is ApiError && error.status == 503 && error.code == 'UNAVAILABLE';
      _publish(_snapshot.copyWith(status: WalkOverviewStatus.error, unavailable: unavailable ? true : null));
    } finally {
      if (identical(_inflight?.cancel, cancel)) _inflight = null;
    }
  }

  /// Loads twice the view unless a fresh loaded area already covers it.
  Future<void> ensure(CatalogBounds required) {
    if (_snapshot.unavailable) return Future.value();
    final area = overviewArea(required);
    if (area == null) return Future.value();
    // The visible view decides; the doubled area is only what gets loaded.
    if (_covered(required) || _requested(area)) {
      // Back inside loaded walks: a request or an error for the area just left no longer concerns this view.
      _inflight?.cancel.cancel();
      _inflight = null;
      _last = area;
      if (_snapshot.status != WalkOverviewStatus.ready) _publish(_snapshot.copyWith(status: WalkOverviewStatus.ready));
      return Future.value();
    }
    return _load(area);
  }

  Future<void> retry() {
    final last = _last;
    return last == null ? Future.value() : _load(last);
  }

  /// Stops a request nobody waits for (the layer was switched off).
  void cancel() {
    _inflight?.cancel.cancel();
    _inflight = null;
    if (_snapshot.status == WalkOverviewStatus.loading) {
      _publish(_snapshot.copyWith(status: _walks.isEmpty ? WalkOverviewStatus.idle : WalkOverviewStatus.ready));
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _inflight?.cancel.cancel();
    _inflight = null;
    super.dispose();
  }
}
