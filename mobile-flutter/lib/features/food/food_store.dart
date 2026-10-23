// The app-wide food cell store and the food of offline copies (site `food-cells.ts`, `offline-food.ts`).
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../app/providers.dart';
import '../../walk_engine/distance.dart';
import '../explore/cell_store.dart';
import '../offline/offline_food.dart';
import 'food_model.dart';
import 'route_proximity.dart';

const foodCacheName = 'food-cells-v1';

/// The manifest holder of [foodStoreProvider]: the card shows its attribution and date.
final foodCellsProvider = Provider<FoodCells>((ref) => FoodCells());

/// Food cells cached on disk under the app support directory, revalidated by ETag. A 503 means the server
/// has no food index: it fails at once and hides the feature.
final foodStoreProvider = Provider<CellStore<FoodPlace>>((ref) {
  final store = ref.watch(foodCellsProvider).store(
        fetch: apiCellFetch(ref.watch(apiProvider), noRetryStatuses: const {503}),
        storage: FileCellStorage(() async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}$foodCacheName')),
      );
  ref.onDispose(store.dispose);
  return store;
});

/// The food of offline copies; installed by the app container.
final foodOfflineSourceProvider = Provider<OfflineFoodSource>(
  (ref) => FoodOfflineSource(
    fetch: apiCellFetch(ref.watch(apiProvider), noRetryStatuses: const {503}),
    cells: ref.watch(foodCellsProvider),
    store: ref.watch(foodStoreProvider),
  ),
);

class _TooLarge implements Exception {
  const _TooLarge();
}

/// Downloads the food cells a route passes for an offline copy and seeds them back when it opens.
class FoodOfflineSource implements OfflineFoodSource {
  FoodOfflineSource({required this._fetch, required this._cells, required this._store});

  final CellFetch _fetch;
  final FoodCells _cells;
  final CellStore<FoodPlace> _store;

  @override
  Future<OfflineFoodDownload> download(List<GeoPoint> geometry, int maxBytes) async {
    if (geometry.length < 2) return const OfflineFoodDownload.none();
    // A warning only when the walker could have had food: the feature was not switched off by the server.
    var available = _cells.manifest != null && !_store.snapshot.maintenance;
    try {
      final manifestBody = jsonEncode((await _fetch(foodManifestPath)).json);
      final manifest = parseFoodManifest(jsonDecode(manifestBody));
      available = true;
      var bytes = utf8.encode(manifestBody).length;
      if (bytes > maxBytes) throw const _TooLarge();
      final wanted = cellsForRoute(geometry).toSet();
      final cells = <OfflineFoodCell>[];
      for (final MapEntry(:key, value: expected) in manifest.cells.entries) {
        if (!wanted.contains(key)) continue;
        final response = await _fetch(foodCellPath(key));
        final body = jsonEncode(response.json);
        final places = parseFoodCell(response.json, key);
        // The cell changed after the manifest was read: the copy would not match itself.
        if (bareEtag(response.etag) != expected.etag || places.length != expected.count) throw const FormatException('food cell changed');
        final size = utf8.encode(body).length;
        bytes += size;
        if (bytes > maxBytes) throw const _TooLarge();
        cells.add(OfflineFoodCell(key: key, etag: expected.etag, body: body, bytes: size));
      }
      return OfflineFoodDownload(
        bundle: OfflineFoodBundle(manifestBody: manifestBody, sourceEditedAt: manifest.sourceEditedAt, attribution: manifest.attribution, cells: cells),
        warning: false,
      );
    } on Exception catch (error) {
      return OfflineFoodDownload(bundle: null, warning: available && !foodUnavailable(error));
    }
  }

  @override
  void seed(OfflineFoodBundle bundle) {
    // A newer manifest already in memory wins: an old copy must not roll the store back.
    final live = _cells.manifest;
    if (live != null && live.editedAt.isAfter(DateTime.parse(bundle.sourceEditedAt))) return;
    final manifest = parseFoodManifest(jsonDecode(bundle.manifestBody));
    for (final cell in bundle.cells) {
      if (parseFoodCell(jsonDecode(cell.body), cell.key).length != manifest.cells[cell.key]?.count) throw const FormatException('Некорректные данные заведений.');
    }
    _store.seedOffline(jsonDecode(bundle.manifestBody), [
      for (final cell in bundle.cells) (key: cell.key, etag: cell.etag, body: jsonDecode(cell.body)),
    ]);
  }
}
