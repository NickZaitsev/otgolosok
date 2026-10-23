// Food places from OpenStreetMap, loaded by map cells (site `src/features/food/types.ts`, `food-cells.ts`).
import 'package:flutter/foundation.dart';

import '../../core/api/api_error.dart';
import '../../walk_engine/distance.dart';
import '../explore/catalog_bounds.dart';
import '../explore/cell_store.dart';

const foodManifestPath = '/api/food/cells';
const foodCellSize = 0.05;

const _invalid = FormatException('Некорректные данные заведений.');
final _foodId = RegExp(r'^osm:(node|way|relation):\d+$');
final _etag = RegExp(r'^[a-f0-9]{32}$');
final _web = RegExp(r'^https?://', caseSensitive: false);

enum FoodKind {
  coffee('coffee'),
  cafe('cafe'),
  restaurant('restaurant'),
  fastFood('fast_food'),
  bakery('bakery'),
  bar('bar');

  const FoodKind(this.wire);
  final String wire;

  static FoodKind? parse(Object? value) {
    for (final kind in values) {
      if (kind.wire == value) return kind;
    }
    return null;
  }
}

@immutable
class FoodPlace {
  const FoodPlace({
    required this.id,
    required this.kind,
    required this.name,
    required this.lat,
    required this.lon,
    this.address,
    this.openingHours,
    this.cuisine,
    this.website,
    this.phone,
  });

  final String id;
  final FoodKind kind;
  final String name;
  final double lat;
  final double lon;
  final String? address;
  final String? openingHours;
  final String? cuisine;
  final String? website;
  final String? phone;

  GeoPoint get location => GeoPoint(lat, lon);
}

/// `floor(coordinate * 20)` clamped to the grid, as the server keys its cells.
String foodCellKey(double lat, double lon) {
  int key(double value, int min, int max) => (value * 20).floor().clamp(min, max);
  return '${key(lat, -1800, 1799)}:${key(lon, -3600, 3599)}';
}

/// Cells of [keys] that touch [bounds].
List<String> foodCellsFor(Iterable<String> keys, CatalogBounds bounds) => keys.where((key) {
      final parts = key.split(':').map(int.parse).toList();
      final lat = parts[0], lon = parts[1];
      return lat / 20 <= bounds.north && (lat + 1) / 20 >= bounds.south && lon / 20 <= bounds.east && (lon + 1) / 20 >= bounds.west;
    }).toList();

bool _integer(Object? value, int min, int max) => value is int && value >= min && value <= max;

/// The food manifest: where the data comes from and which cells hold places.
@immutable
class FoodManifest {
  const FoodManifest({required this.sourceEditedAt, required this.attribution, required this.cells});

  final String sourceEditedAt;
  final String attribution;
  final Map<String, ManifestCell> cells;

  DateTime get editedAt => DateTime.parse(sourceEditedAt);
}

FoodManifest parseFoodManifest(Object? value) {
  if (value is! Map<String, Object?> || value['version'] != 1 || value['cellSize'] != foodCellSize) throw _invalid;
  final edited = value['sourceEditedAt'], attribution = value['attribution'], cells = value['cells'];
  if (edited is! String || DateTime.tryParse(edited) == null || attribution is! String || attribution.trim().isEmpty || cells is! List<Object?>) {
    throw _invalid;
  }
  final result = <String, ManifestCell>{};
  for (final cell in cells) {
    if (cell is! Map<String, Object?>) throw _invalid;
    final lat = cell['lat'], lon = cell['lon'], count = cell['count'], etag = cell['etag'];
    final key = '$lat:$lon';
    if (!_integer(lat, -1800, 1799) ||
        !_integer(lon, -3600, 3599) ||
        !_integer(count, 0, 9007199254740991) ||
        etag is! String ||
        !_etag.hasMatch(etag) ||
        result.containsKey(key)) {
      throw _invalid;
    }
    result[key] = ManifestCell(count: count! as int, etag: etag);
  }
  return FoodManifest(sourceEditedAt: edited, attribution: attribution, cells: result);
}

String? _optional(Object? value) => switch (value) {
      null => null,
      String() => value,
      _ => throw _invalid,
    };

List<FoodPlace> parseFoodCell(Object? value, String key) {
  if (value is! Map<String, Object?> || !_integer(value['lat'], -1800, 1799) || !_integer(value['lon'], -3600, 3599)) throw _invalid;
  final places = value['places'];
  if ('${value['lat']}:${value['lon']}' != key || places is! List<Object?>) throw _invalid;
  final ids = <String>{};
  final result = <FoodPlace>[];
  for (final item in places) {
    if (item is! Map<String, Object?>) throw _invalid;
    final id = item['id'], name = item['name'], lat = item['lat'], lon = item['lon'], kind = FoodKind.parse(item['kind']);
    if (id is! String || !_foodId.hasMatch(id) || !ids.add(id) || kind == null || name is! String || name.trim().isEmpty) throw _invalid;
    if (lat is! num || !lat.isFinite || lat.abs() > 90 || lon is! num || !lon.isFinite || lon.abs() > 180) throw _invalid;
    if (foodCellKey(lat.toDouble(), lon.toDouble()) != key) throw _invalid;
    final website = _optional(item['website']);
    if (website != null && !_web.hasMatch(website)) throw _invalid;
    result.add(FoodPlace(
      id: id,
      kind: kind,
      name: name,
      lat: lat.toDouble(),
      lon: lon.toDouble(),
      address: _optional(item['address']),
      openingHours: _optional(item['openingHours']),
      cuisine: _optional(item['cuisine']),
      website: website,
      phone: _optional(item['phone']),
    ));
  }
  return result;
}

String foodCellPath(String key) {
  final parts = key.split(':');
  return '$foodManifestPath/${parts[0]}/${parts[1]}';
}

/// A 503 hides the feature: the server has no food index.
bool foodUnavailable(Object error) => error is ApiError && error.status == 503;

/// The food cell store with the last parsed manifest, which the card needs for its attribution.
class FoodCells {
  FoodManifest? manifest;

  CellStore<FoodPlace> store({required CellFetch fetch, required CellStorage storage}) => CellStore<FoodPlace>(
        fetch: fetch,
        storage: storage,
        manifestPath: foodManifestPath,
        cellPath: foodCellPath,
        parseManifest: (json) => (manifest = parseFoodManifest(json)).cells,
        parseCell: parseFoodCell,
        cellsFor: foodCellsFor,
        pointId: (place) => place.id,
        isUnavailable: foodUnavailable,
      );
}
