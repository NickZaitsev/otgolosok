// Parking for car walks: the places near a chosen stop (site parking-client.ts) and the parking
// layer of the map, loaded by cells (site parking-cells.ts).
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../app/providers.dart';
import '../../core/api/api_error.dart';
import '../../walk_engine/car_route.dart';
import '../../walk_engine/cities.dart' show cityAt;
import '../explore/catalog_bounds.dart';
import '../explore/cell_store.dart';

const parkingManifestPath = '/api/parking/cells';

/// The parking layer is drawn from this MapLibre zoom (512 px tiles) on: the site's Leaflet z14.
const parkingMinZoom = 13.0;

/// The «Парковки» toggle of the explore map; without a choice it follows «Как передвигаемся».
const parkingToggleKey = 'otgolosok:parking-layer';

const _invalid = FormatException('Некорректные данные парковок.');
final _parkingId = RegExp(r'^osm:(node|way|relation):\d+$');

bool _point(Object? value) {
  if (value is! Map<String, Object?>) return false;
  final lat = value['lat'], lon = value['lon'];
  return lat is num && lat.isFinite && lat.abs() <= 90 && lon is num && lon.isFinite && lon.abs() <= 180;
}

/// `isParkingPlace` of the site client.
bool isParkingPlace(Object? value) {
  if (value is! Map<String, Object?>) return false;
  final id = value['id'], name = value['name'], fee = value['fee'], hours = value['openingHours'];
  return id is String &&
      _parkingId.hasMatch(id) &&
      name is String &&
      name.trim().isNotEmpty &&
      name.length <= 180 &&
      _point(value['location']) &&
      _point(value['entrance']) &&
      _point(value['exit']) &&
      _point(value['pedestrianAccess']) &&
      (value['access'] == 'public' || value['access'] == 'unknown') &&
      (fee == null || fee is bool) &&
      (hours == null || hours is String);
}

bool _source(Map<String, Object?> value) {
  final edited = value['sourceEditedAt'], attribution = value['attribution'];
  return edited is String && DateTime.tryParse(edited) != null && attribution is String && attribution.trim().isNotEmpty;
}

/// `GET /api/parking/near` answer: the places sorted by the server, nearest first.
List<ParkingPlace> parseNearbyParking(Object? value) {
  if (value is! Map<String, Object?> || !_source(value)) throw _invalid;
  final places = value['places'];
  if (places is! List<Object?> || !places.every(isParkingPlace)) throw _invalid;
  final parsed = places.map(ParkingPlace.fromJson).toList();
  if (parsed.map((place) => place.id).toSet().length != parsed.length) throw _invalid;
  return parsed;
}

bool _integer(Object? value, num min, num max) => value is int && value >= min && value <= max;

int _factor(num cellSize) => (1 / cellSize).round();

String parkingCellKey(double lat, double lon, num cellSize) {
  final factor = _factor(cellSize);
  return '${(lat * factor).floor()}:${(lon * factor).floor()}';
}

/// Cells of [keys] that touch [bounds].
List<String> parkingCellsFor(Iterable<String> keys, CatalogBounds bounds, num cellSize) {
  final factor = _factor(cellSize);
  return keys.where((key) {
    final parts = key.split(':').map(int.parse).toList();
    final lat = parts[0], lon = parts[1];
    return lat / factor <= bounds.north && (lat + 1) / factor >= bounds.south && lon / factor <= bounds.east && (lon + 1) / factor >= bounds.west;
  }).toList();
}

/// The parsed manifest's cell size, needed to read cells; set by [ParkingCells.parseManifest].
class ParkingCells {
  num cellSize = 0.05;
  String? attribution;

  Map<String, ManifestCell> parseManifest(Object? value) {
    if (value is! Map<String, Object?> || value['version'] != 1 || !_source(value)) throw _invalid;
    final size = value['cellSize'], cells = value['cells'];
    if (size is! num || size <= 0 || size > 1 || cells is! List<Object?>) throw _invalid;
    final factor = _factor(size);
    final result = <String, ManifestCell>{};
    for (final cell in cells) {
      if (cell is! Map<String, Object?>) throw _invalid;
      final lat = cell['lat'], lon = cell['lon'], count = cell['count'], etag = cell['etag'];
      final key = '$lat:$lon';
      if (!_integer(lat, -90 * factor, 90 * factor - 1) ||
          !_integer(lon, -180 * factor, 180 * factor - 1) ||
          !_integer(count, 0, 9007199254740991) ||
          etag is! String ||
          !RegExp(r'^[a-f0-9]{32}$').hasMatch(etag) ||
          result.containsKey(key)) {
        throw _invalid;
      }
      result[key] = ManifestCell(count: count! as int, etag: etag);
    }
    cellSize = size;
    attribution = value['attribution']! as String;
    return result;
  }

  List<ParkingPlace> parseCell(Object? value, String key) {
    if (value is! Map<String, Object?> || '${value['lat']}:${value['lon']}' != key) throw _invalid;
    final places = value['places'];
    if (places is! List<Object?>) throw _invalid;
    final ids = <String>{};
    final result = <ParkingPlace>[];
    for (final place in places) {
      if (!isParkingPlace(place)) throw _invalid;
      final parsed = ParkingPlace.fromJson(place);
      if (!ids.add(parsed.id) || parkingCellKey(parsed.location.lat, parsed.location.lon, cellSize) != key) throw _invalid;
      result.add(parsed);
    }
    return result;
  }

  /// A cell store for the parking layer.
  CellStore<ParkingPlace> store({required CellFetch fetch, required CellStorage storage}) => CellStore<ParkingPlace>(
        fetch: fetch,
        storage: storage,
        manifestPath: parkingManifestPath,
        cellPath: (key) {
          final parts = key.split(':');
          return '/api/parking/cells/${parts[0]}/${parts[1]}';
        },
        parseManifest: parseManifest,
        parseCell: parseCell,
        cellsFor: (keys, bounds) => parkingCellsFor(keys, bounds, cellSize),
        pointId: (place) => place.id,
        isUnavailable: (error) => error is ApiError && error.status == 503,
      );
}

/// Cached parking cells; only an accelerator, every failure counts as an empty cache.
final parkingStorageProvider = Provider<CellStorage>(
  (ref) => FileCellStorage(() async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}parking-cells-v1')),
);

/// The manifest holder of [parkingStoreProvider]: the parking card shows its attribution.
final parkingCellsProvider = Provider<ParkingCells>((ref) => ParkingCells());

/// The parking cells of the builder and the explore map, one store app-wide. A 503 means the server has no
/// parking index: it fails at once and hides the layer.
final parkingStoreProvider = Provider<CellStore<ParkingPlace>>((ref) {
  final store = ref.watch(parkingCellsProvider).store(
        fetch: apiCellFetch(ref.watch(apiProvider), noRetryStatuses: const {503}),
        storage: ref.watch(parkingStorageProvider),
      );
  ref.onDispose(store.dispose);
  return store;
});

/// Whether a parking place may be shown on the builder map (within the walk area).
bool inWalkArea(ParkingPlace place) => cityAt(place.location.lat, place.location.lon) != null;
