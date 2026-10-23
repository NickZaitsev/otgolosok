/// An optional layer of the explore map loaded by cells, such as food places or parking (site
/// `use-around-food.ts`, `use-around-parking.ts`): a remembered toggle, a zoom from which it loads, and the
/// state of the visible area for the notices.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/settings/settings_store.dart';
import '../../walk_engine/distance.dart';
import 'catalog_bounds.dart';
import 'cell_store.dart';
import 'map_cells.dart';

/// What the layer tells the walker about the visible area.
enum CellLayerNotice { unavailable, zoomIn, loading, error }

class CellLayer<T> extends ChangeNotifier {
  /// [eagerManifest] loads the manifest before the layer is switched on, so a toggle can wait for the
  /// server to have the layer at all (food); otherwise it loads with the first use (parking).
  CellLayer({
    required this.store,
    required SettingsStore settings,
    required this.toggleKey,
    required this.minZoom,
    bool enabledByDefault = false,
    bool eagerManifest = false,
  }) : _settings = settings {
    final stored = settings.readString(toggleKey);
    _enabled = stored == '1' || (stored != '0' && enabledByDefault);
    store.addListener(notifyListeners);
    if (eagerManifest || _enabled) unawaited(store.ensureManifest());
  }

  final CellStore<T> store;
  final SettingsStore _settings;
  final String toggleKey;

  /// MapLibre zoom from which cells load and markers show.
  final double minZoom;

  late bool _enabled;
  MapViewport? _viewport;
  bool _disposed = false;

  bool get enabled => _enabled;
  MapViewport? get viewport => _viewport;

  /// The server has the layer: its manifest is known and it is not switched off.
  bool get available => store.snapshot.manifestKeys != null && !store.snapshot.maintenance;

  /// Whether markers are drawn for the current view.
  bool get showing => _enabled && available && (_viewport?.zoom ?? 0) >= minZoom;

  /// The points inside the visible area while the layer shows.
  List<T> visible(GeoPoint Function(T point) location) {
    final viewport = _viewport;
    if (!showing || viewport == null) return const [];
    return [for (final point in store.snapshot.points) if (viewport.required.containsPoint(location(point))) point];
  }

  CellLayerNotice? get notice {
    if (!_enabled) return null;
    final snapshot = store.snapshot;
    if (snapshot.maintenance) return CellLayerNotice.unavailable;
    if (snapshot.manifestKeys == null && snapshot.manifestStatus == ManifestStatus.error) return CellLayerNotice.error;
    final viewport = _viewport;
    if (viewport == null) return null;
    if (viewport.zoom < minZoom) return CellLayerNotice.zoomIn;
    return switch (areaStatus(snapshot, viewport.required, select: store.cellsFor)) {
      CellStatus.loading => CellLayerNotice.loading,
      CellStatus.error => CellLayerNotice.error,
      CellStatus.ready => null,
    };
  }

  void onViewport(MapViewport viewport) {
    _viewport = viewport;
    _load();
  }

  void _load() {
    final viewport = _viewport;
    if (!_enabled) return;
    if (viewport != null && viewport.zoom >= minZoom) {
      unawaited(store.ensureArea([viewport.required]));
    } else {
      unawaited(store.ensureManifest());
    }
  }

  /// Back in the app: a stale manifest is revalidated with the next look at the area.
  void resume() => _load();

  Future<void> toggle() async {
    _enabled = !_enabled;
    notifyListeners();
    _load();
    try {
      await _settings.writeString(toggleKey, _enabled ? '1' : '0');
    } on Exception catch (error) {
      // The choice still applies to this session.
      debugPrint('Map layer preference $toggleKey not saved: ${error.runtimeType}');
    }
  }

  void retry() {
    final viewport = _viewport;
    unawaited(store.retry([if (viewport != null && viewport.zoom >= minZoom) viewport.required]));
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    store.removeListener(notifyListeners);
    super.dispose();
  }
}
