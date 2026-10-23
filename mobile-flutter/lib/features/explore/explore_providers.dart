/// Long-lived services of the explore screen: they outlive the screen widget, so returning to the tab keeps
/// the loaded map cells and walk lines.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../app/providers.dart';
import '../../core/location/locate.dart';
import '../../core/location/walk_service_permissions.dart';
import 'cell_store.dart';
import 'map_cells.dart';
import 'walk_overview.dart';

/// Map cells cached on disk under the app support directory (`map-cells-v1`), revalidated by ETag.
final mapCellStoreProvider = Provider<MapCellStore>((ref) {
  final store = createMapCellStore(
    fetch: apiCellFetch(ref.watch(apiProvider)),
    storage: FileCellStorage(() async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}$mapCellsCacheName')),
  );
  ref.onDispose(store.dispose);
  return store;
});

final walkOverviewStoreProvider = Provider<WalkOverviewStore>((ref) {
  final store = WalkOverviewStore(fetch: apiWalkOverviewFetch(ref.watch(apiProvider)));
  ref.onDispose(store.dispose);
  return store;
});

final locationPermissionsProvider = Provider<LocationPermissions>((ref) => WalkServiceLocationPermissions());

/// Remembered closing of the «Смотрите истории рядом с вами» card.
const geoPromptDismissedKey = 'otgolosok:explore:geo-prompt-dismissed';
