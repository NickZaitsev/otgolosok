/// The catalog of story places on the map, split into 1° cells (port of `src/features/explore/map-cells.ts`).
library;

import '../../core/api/api_error.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/json_read.dart' show jsIsSafeInteger;
import 'catalog_bounds.dart';
import 'cell_store.dart';

/// One slim map point of `GET /api/content/map-cells/{lat}/{lon}`.
class CatalogPoint {
  const CatalogPoint({
    required this.id,
    required this.location,
    required this.title,
    required this.address,
    required this.durationSec,
    required this.facts,
    required this.sources,
    required this.photo,
  });

  final String id;
  final GeoPoint location;
  final String title;
  final String address;

  /// Null for a place whose text is ready but not voiced yet.
  final double? durationSec;
  final int facts;
  final int sources;

  /// The detail has a photo: the card keeps the preview slot while it loads.
  final bool photo;

  @override
  bool operator ==(Object other) =>
      other is CatalogPoint &&
      other.id == id &&
      other.location == location &&
      other.title == title &&
      other.address == address &&
      other.durationSec == durationSec &&
      other.facts == facts &&
      other.sources == sources &&
      other.photo == photo;

  @override
  int get hashCode => Object.hash(id, location, title, address, durationSec, facts, sources, photo);
}

const mapCellsManifestPath = '/api/content/map-cells';
const mapCellsCacheName = 'map-cells-v1';

String mapCellPath(String key) => '$mapCellsManifestPath/${key.replaceFirst(':', '/')}';

bool _isInteger(Object? value, int min, int max) => jsIsSafeInteger(value) && (value! as num) >= min && (value as num) <= max;
bool _isCount(Object? value) => jsIsSafeInteger(value) && (value! as num) >= 0;
final _etag = RegExp(r'^[0-9a-f]{32}$');

/// Manifest cells whose square [lat, lat+1] × [lon, lon+1] intersects the rectangle; touching edges count.
List<String> cellsFor(Iterable<String> manifestKeys, CatalogBounds bounds) {
  final keys = <String>[];
  for (final key in manifestKeys) {
    final parts = key.split(':');
    final lat = int.parse(parts[0]);
    final lon = int.parse(parts[1]);
    if (lat <= bounds.north && lat + 1 >= bounds.south && lon <= bounds.east && lon + 1 >= bounds.west) keys.add(key);
  }
  return keys;
}

Map<String, ManifestCell> parseMapManifest(Object? value) {
  const message = 'Некорректный список областей карты.';
  if (value is! Map<String, Object?> || value['version'] != 1 || value['cellSize'] != 1 || value['cells'] is! List<Object?>) {
    throw const FormatException(message);
  }
  final cells = <String, ManifestCell>{};
  for (final cell in value['cells']! as List<Object?>) {
    if (cell is! Map<String, Object?> ||
        !_isInteger(cell['lat'], -90, 89) ||
        !_isInteger(cell['lon'], -180, 179) ||
        !_isCount(cell['count']) ||
        cell['etag'] is! String ||
        !_etag.hasMatch(cell['etag']! as String)) {
      throw const FormatException(message);
    }
    cells['${(cell['lat']! as num).toInt()}:${(cell['lon']! as num).toInt()}'] =
        ManifestCell(count: (cell['count']! as num).toInt(), etag: cell['etag']! as String);
  }
  return cells;
}

List<CatalogPoint> parseMapCell(Object? value, String key) {
  const message = 'Некорректная область карты.';
  if (value is! Map<String, Object?> || value['points'] is! List<Object?>) throw const FormatException(message);
  final lat = value['lat'];
  final lon = value['lon'];
  if (!jsIsSafeInteger(lat) || !jsIsSafeInteger(lon) || '${(lat! as num).toInt()}:${(lon! as num).toInt()}' != key) {
    throw const FormatException(message);
  }
  return [
    for (final point in value['points']! as List<Object?>) _parsePoint(point, message),
  ];
}

CatalogPoint _parsePoint(Object? point, String message) {
  if (point is! Map<String, Object?>) throw FormatException(message);
  final id = point['id'];
  final lat = point['lat'];
  final lon = point['lon'];
  final title = point['title'];
  final address = point['address'];
  final duration = point['durationSec'];
  final photo = point['photo'];
  if (id is! String ||
      id.isEmpty ||
      lat is! num ||
      !lat.isFinite ||
      lon is! num ||
      !lon.isFinite ||
      title is! String ||
      address is! String ||
      !(duration == null || (duration is num && duration.isFinite && duration > 0)) ||
      !_isCount(point['facts']) ||
      !_isCount(point['sources']) ||
      !(photo == null && !point.containsKey('photo') || photo == true)) {
    throw FormatException(message);
  }
  return CatalogPoint(
    id: id,
    location: GeoPoint(lat.toDouble(), lon.toDouble()),
    title: title,
    address: address,
    durationSec: (duration as num?)?.toDouble(),
    facts: (point['facts']! as num).toInt(),
    sources: (point['sources']! as num).toInt(),
    photo: photo == true,
  );
}

/// A 503 the server answers while the content is being updated.
bool isServiceMaintenance(Object error) => error is ApiError && error.status == 503 && error.code == 'SERVICE_MAINTENANCE';

typedef MapCellStore = CellStore<CatalogPoint>;

MapCellStore createMapCellStore({required CellFetch fetch, required CellStorage storage, DateTime Function()? now}) => CellStore<CatalogPoint>(
      fetch: fetch,
      storage: storage,
      now: now,
      manifestPath: mapCellsManifestPath,
      cellPath: mapCellPath,
      parseManifest: parseMapManifest,
      parseCell: parseMapCell,
      cellsFor: cellsFor,
      pointId: (point) => point.id,
      isUnavailable: isServiceMaintenance,
    );

/// Status of an area: loading or error only for its cells without any copy; revalidating cached data is silent.
/// An area crossing a cell line stays loading until every cell is ready, so nothing is computed from half of it.
CellStatus areaStatus(CellSnapshot<Object?> snapshot, CatalogBounds bounds) {
  final keys = snapshot.manifestKeys;
  if (keys == null) return snapshot.manifestStatus == ManifestStatus.error ? CellStatus.error : CellStatus.loading;
  var result = CellStatus.ready;
  for (final key in cellsFor(keys, bounds)) {
    if (snapshot.loadedKeys.contains(key)) continue;
    if (snapshot.cellStatus[key] == CellStatus.error) return CellStatus.error;
    result = CellStatus.loading;
  }
  return result;
}
