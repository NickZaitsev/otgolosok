/// «Рядом»: the map of ready stories, walks drawn on it, the stories near the user and the place card
/// (port of `src/features/explore/around-screen.tsx` without the story-preparation and food/parking layers).
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/location/locate.dart';
import '../../walk_engine/cities.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/nearby_stories.dart';
import '../places/place_sheet.dart';
import '../places/place_story.dart';
import '../walks/current_city.dart';
import 'catalog_bounds.dart';
import 'cell_store.dart';
import 'explore_map.dart';
import 'explore_providers.dart';
import 'explore_sheets.dart';
import 'map_cells.dart';
import 'map_clusters.dart';
import 'map_location_source.dart';
import 'nearby_walks.dart';
import 'walk_overview.dart';

/// Above this accuracy the position is shown as weak (site `geoControlState`).
const double _weakAccuracyM = 50;

/// MapLibre zoom a focused place or position is shown at (site z17).
const double _focusZoom = 16;

/// During maintenance the catalog is retried this often (site `use-map-catalog.ts`).
const _maintenanceRetry = Duration(seconds: 5);

sealed class _Panel {
  const _Panel();
}

class _NoPanel extends _Panel {
  const _NoPanel();
}

class _PromptPanel extends _Panel {
  const _PromptPanel();
}

class _PlacePanel extends _Panel {
  const _PlacePanel(this.id, {this.expanded = false});

  final String id;
  final bool expanded;
}

class _NearbyPanel extends _Panel {
  const _NearbyPanel(this.center);

  final GeoPoint center;
}

class _WalksPanel extends _Panel {
  const _WalksPanel(this.keys, this.selected);

  final List<String> keys;
  final String? selected;
}

class _ClusterPanel extends _Panel {
  const _ClusterPanel(this.ids);

  final List<String> ids;
}

enum _Geo { idle, locating, ready, error, denied }

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key, this.placeId});

  /// A place to open, from `/?place=osm:node:1` (already validated by the router).
  final String? placeId;

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  final _map = GlobalKey<ExploreMapState>();
  final _fixSource = MapFixSource();
  late final MapCellStore _cells = ref.read(mapCellStoreProvider);
  late final WalkOverviewStore _overview = ref.read(walkOverviewStoreProvider);
  late final Locator _locator = Locator(permissions: ref.read(locationPermissionsProvider), source: _fixSource);
  late final AppLifecycleListener _lifecycle;
  late final GeoPoint _initialCenter;
  late final double _initialZoom;

  MapViewport? _viewport;
  _Panel _panel = const _NoPanel();
  int _nearbyRadius = 200;

  var _geo = _Geo.idle;
  LocateError? _geoError;
  LocatedFix? _user;
  String _geoMessage = '';
  var _geoOutside = false;
  void Function()? _cancelLocate;

  var _walksEnabled = false;

  /// A linked place outside the loaded cells opens from its detail header.
  PlaceHeader? _linkedHeader;
  String? _linkedId;
  String _linkNotice = '';
  var _linkRetry = false;

  NearbyWalksState _nearbyWalks = const NearbyWalksLoading();
  CancelToken? _nearbyCancel;
  GeoPoint? _nearbyWalksFor;

  Timer? _maintenanceTimer;
  List<MapCluster> _clusters = const [];
  ({List<CatalogPoint> points, int level, CatalogBounds? area, LocatedFix? user})? _clusterInput;

  @override
  void initState() {
    super.initState();
    final city = ref.read(currentCityProvider);
    _initialCenter = GeoPoint(city.centerLat, city.centerLon);
    _initialZoom = city.zoom - 1.0;
    final settings = ref.read(settingsProvider);
    _walksEnabled = settings.readString(walkOverviewToggleKey) == '1';
    if (settings.readString(geoPromptDismissedKey) != '1') _panel = const _PromptPanel();
    _cells.addListener(_cellsChanged);
    _overview.addListener(_overviewChanged);
    _lifecycle = AppLifecycleListener(onResume: _resumed);
    _openLinked(widget.placeId);
  }

  @override
  void didUpdateWidget(ExploreScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.placeId != oldWidget.placeId) _openLinked(widget.placeId);
  }

  @override
  void dispose() {
    _cancelLocate?.call();
    _nearbyCancel?.cancel();
    _maintenanceTimer?.cancel();
    _lifecycle.dispose();
    _cells.removeListener(_cellsChanged);
    _overview.removeListener(_overviewChanged);
    _overview.cancel();
    _fixSource.dispose();
    super.dispose();
  }

  // ---- Catalog -------------------------------------------------------------------------------------

  List<CatalogBounds> get _areas => [
        if (_viewport case final viewport?) ...[viewport.required, viewport.buffered],
        if (_panel case _NearbyPanel(:final center)) nearbyBounds(center, _nearbyRadius),
      ];

  void _ensureCells() {
    final areas = _areas;
    if (areas.isNotEmpty) unawaited(_cells.ensureArea(areas));
  }

  void _cellsChanged() {
    if (!mounted) return;
    final snapshot = _cells.snapshot;
    if (snapshot.maintenance) {
      _maintenanceTimer ??= Timer.periodic(_maintenanceRetry, (_) => unawaited(_cells.retry(_areas)));
    } else {
      _maintenanceTimer?.cancel();
      _maintenanceTimer = null;
    }
    _recluster();
    setState(() {});
  }

  void _overviewChanged() {
    if (mounted) setState(() {});
  }

  void _resumed() {
    // Back in the app: a stale manifest is revalidated on the next look at the area.
    _ensureCells();
    if (_walksEnabled && _viewport != null) unawaited(_overview.ensure(_viewport!.required));
  }

  void _onViewport(MapViewport viewport) {
    _viewport = viewport;
    _ensureCells();
    if (_walksEnabled) unawaited(_overview.ensure(viewport.required));
    _recluster();
    setState(() {});
  }

  void _recluster() {
    final viewport = _viewport;
    final points = _cells.snapshot.points;
    final level = viewport == null ? 0 : leafletZoom(viewport.zoom);
    final area = viewport?.buffered;
    final input = (points: points, level: level, area: area, user: _user);
    final previous = _clusterInput;
    if (previous != null &&
        identical(previous.points, points) &&
        previous.level == level &&
        previous.area == area &&
        previous.user == _user) {
      return;
    }
    _clusterInput = input;
    if (viewport == null) {
      _clusters = const [];
      return;
    }
    final visible = points.where((point) => area!.containsPoint(point.location)).toList();
    // Closer pins come first, as on the site, so groups form around what is near the user.
    final user = _user;
    if (user != null) {
      final here = GeoPoint(user.lat, user.lon);
      visible.sort((a, b) => distanceMeters(here, a.location).compareTo(distanceMeters(here, b.location)));
    }
    _clusters = clusterPoints([for (final point in visible) ClusterInput(point.id, point.location)], viewport.zoom);
  }

  CatalogPoint? _point(String id) {
    for (final point in _cells.snapshot.points) {
      if (point.id == id) return point;
    }
    return null;
  }

  // ---- Panels --------------------------------------------------------------------------------------

  void _show(_Panel panel) {
    if (panel is! _NearbyPanel) {
      _nearbyCancel?.cancel();
      _nearbyWalksFor = null;
    }
    setState(() => _panel = panel);
    _ensureCells();
  }

  void _close() => _show(const _NoPanel());

  void _selectPlace(String id, {GeoPoint? focus}) {
    _show(_PlacePanel(id));
    if (focus != null) unawaited(_map.currentState?.focus(focus));
  }

  void _openLinked(String? id) {
    if (id == null) return;
    _linkedId = id;
    _linkedHeader = null;
    _linkNotice = '';
    _panel = _PlacePanel(id);
    final point = _point(id);
    if (point != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _map.currentState?.focus(point.location, zoom: _focusZoom));
      return;
    }
    _linkNotice = 'Открываем историю…';
    _linkRetry = false;
    unawaited(_loadLinked(id));
  }

  /// A linked place outside the loaded cells: its detail header places it on the map.
  Future<void> _loadLinked(String id) async {
    try {
      final story = await ref.read(placeStoryRepositoryProvider).load(id, ref.read(localeProvider));
      if (!mounted || _linkedId != id) return;
      final header = story?.place;
      if (story == null) {
        setState(() {
          _linkNotice = 'Эта история больше недоступна.';
          if (_panel case _PlacePanel(id: final open) when open == id) _panel = const _NoPanel();
        });
        return;
      }
      setState(() {
        _linkNotice = '';
        _linkedHeader = header;
      });
      if (header != null) {
        await _map.currentState?.focus(header.location, zoom: _focusZoom);
        _ensureCells();
      }
    } on Object catch (error) {
      if (!mounted || _linkedId != id) return;
      if (error is! ApiError && error is! FormatException) debugPrint('Linked place failed: $error');
      setState(() {
        _linkNotice = 'Не удалось открыть историю.';
        _linkRetry = true;
      });
    }
  }

  void _onClusterTap(MapCluster cluster) {
    if (!cluster.isGroup) {
      _selectPlace(cluster.ids.single);
      return;
    }
    final zoom = _map.currentState?.zoom ?? _viewport?.zoom ?? mapMinZoom;
    // A group that stays together at the deepest zoom is listed instead of spread out.
    if (zoom >= mapMaxZoom - 0.05 || (cluster.bounds.west == cluster.bounds.east && cluster.bounds.south == cluster.bounds.north)) {
      _show(_ClusterPanel(cluster.ids));
      return;
    }
    unawaited(_map.currentState?.fit(cluster.bounds));
  }

  void _onWalksTap(List<String> keys) => _show(_WalksPanel(keys, keys.length == 1 ? keys.single : null));

  void _onMapTap(GeoPoint point) {
    // A tap on the map looks for ready stories and walks around that point.
    _show(_NearbyPanel(point));
    _loadNearbyWalks(point);
  }

  void _loadNearbyWalks(GeoPoint center, {bool force = false}) {
    if (!force && _nearbyWalksFor == center) return;
    _nearbyCancel?.cancel();
    final cancel = CancelToken();
    _nearbyCancel = cancel;
    _nearbyWalksFor = center;
    setState(() => _nearbyWalks = const NearbyWalksLoading());
    unawaited(fetchNearbyWalks(ref.read(apiProvider), center, cancel: cancel).then((walks) {
      if (!mounted || cancel.isCancelled) return;
      setState(() => _nearbyWalks = NearbyWalksReady(walks));
    }, onError: (Object error) {
      if (!mounted || cancel.isCancelled) return;
      if (error is! ApiError && error is! FormatException) debugPrint('Nearby walks failed: $error');
      setState(() => _nearbyWalks = const NearbyWalksFailed());
    }));
  }

  void _openWalk(String location) => unawaited(context.push(location));

  Future<void> _toggleWalks() async {
    final enabled = !_walksEnabled;
    setState(() => _walksEnabled = enabled);
    final settings = ref.read(settingsProvider);
    try {
      await (enabled ? settings.writeString(walkOverviewToggleKey, '1') : settings.remove(walkOverviewToggleKey));
    } on Object catch (error) {
      // The choice still applies to this session.
      debugPrint('Walk layer preference not saved: $error');
    }
    if (!enabled) {
      _overview.cancel();
      if (_panel is _WalksPanel) _close();
    } else if (_viewport != null) {
      unawaited(_overview.ensure(_viewport!.required));
    }
  }

  Future<void> _dismissPrompt() async {
    _close();
    try {
      await ref.read(settingsProvider).writeString(geoPromptDismissedKey, '1');
    } on Object catch (error) {
      debugPrint('Geo prompt dismissal not saved: $error');
    }
  }

  // ---- Location ------------------------------------------------------------------------------------

  /// A coarse point first, then the refined one; nearby stories are searched around the final fix.
  void _locate() {
    _cancelLocate?.call();
    setState(() {
      _geo = _Geo.locating;
      _geoError = null;
      _user = null;
      _geoMessage = '';
      _geoOutside = false;
    });
    var first = true;
    _cancelLocate = _locator.locate((update) {
      if (!mounted) return;
      switch (update) {
        case LocateErrorUpdate(:final error):
          _cancelLocate = null;
          final denied = error == LocateError.permissionDenied;
          setState(() {
            _geo = denied ? _Geo.denied : _Geo.error;
            _geoError = error;
            _user = null;
            _geoMessage = '${context.t(describeLocateError(error))} ${context.t(denied ? 'Можно разрешить его в настройках или выбрать место на карте.' : 'Выберите дом на карте или повторите попытку.')}';
            if (denied && _panel is _PromptPanel) _panel = const _NoPanel();
          });
        case LocateFixUpdate(:final fix, :final isFinal):
          final point = GeoPoint(fix.lat, fix.lon);
          setState(() => _user = fix);
          _recluster();
          if (first || isFinal) unawaited(_map.currentState?.focus(point, zoom: math.max(_map.currentState?.zoom ?? 0, _focusZoom)));
          first = false;
          if (!isFinal) return;
          _cancelLocate = null;
          _settle(fix);
      }
    });
  }

  void _settle(LocatedFix fix) {
    final point = GeoPoint(fix.lat, fix.lon);
    final city = cityAt(fix.lat, fix.lon);
    final radius = nearbyRadiusForAccuracy(fix.accuracyM);
    if (city != null) unawaited(ref.read(currentCityProvider.notifier).choose(city));
    setState(() {
      _geo = _Geo.ready;
      _geoOutside = city == null;
      if (_panel is _PromptPanel) _panel = const _NoPanel();
      _geoMessage = city == null
          ? context.t('Вы сейчас за пределами нашего каталога.')
          : radius != null
              ? ''
              : fix.accuracyM.isFinite
                  ? context.t('Положение приблизительное: точность около {accuracy} м. Выберите точку на карте, чтобы точно искать рядом.',
                      {'accuracy': fix.accuracyM.round()})
                  : context.t('Положение приблизительное. Выберите точку на карте, чтобы точно искать рядом.');
    });
    if (city != null && radius != null) {
      _nearbyRadius = math.max(_nearbyRadius, radius);
      _show(_NearbyPanel(point));
      _loadNearbyWalks(point);
    }
  }

  void _showCity(City city) {
    unawaited(ref.read(currentCityProvider.notifier).choose(city));
    unawaited(_map.currentState?.focus(GeoPoint(city.centerLat, city.centerLon), zoom: city.zoom - 1.0));
    setState(() {
      _geoMessage = '';
      _geoOutside = false;
    });
  }

  Future<void> _openSettings() async {
    try {
      await ref.read(locationPermissionsProvider).openSettings();
    } on Object catch (error) {
      debugPrint('App settings did not open: $error');
    }
  }

  // ---- Build ---------------------------------------------------------------------------------------

  ({IconData icon, String description}) _geoControl(BuildContext context) {
    final user = _user;
    final unavailable = _geoError == LocateError.unsupported;
    if (_geo == _Geo.denied) return (icon: Icons.location_disabled, description: context.t('Нет доступа к геолокации.'));
    if (unavailable) return (icon: Icons.location_disabled, description: context.t('Геолокация недоступна на этом устройстве.'));
    if (_geo == _Geo.locating) return (icon: Icons.location_searching, description: context.t('Определяем положение…'));
    if (_geo == _Geo.error || (_geo == _Geo.ready && user != null && user.accuracyM > _weakAccuracyM)) {
      return (
        icon: Icons.location_searching,
        description: user != null && user.accuracyM.isFinite
            ? context.t('Низкая точность геолокации: около {accuracy} м.', {'accuracy': user.accuracyM.round()})
            : context.t('Не удаётся определить точное местоположение.'),
      );
    }
    if (_geo == _Geo.ready) return (icon: Icons.my_location, description: context.t('Местоположение определено.'));
    return (icon: Icons.my_location, description: context.t('Моё местоположение'));
  }

  Widget? _catalogNotice(BuildContext context) {
    final snapshot = _cells.snapshot;
    final viewport = _viewport;
    if (snapshot.maintenance) return ExploreNotice(message: context.t('Сервис обновляется. Карта загрузится автоматически.'));
    if (viewport == null) return null;
    return switch (areaStatus(snapshot, viewport.required)) {
      CellStatus.error => ExploreNotice(
          message: context.t('Не все места загрузились.'),
          alert: true,
          retryLabel: context.t('Повторить загрузку мест'),
          onRetry: () => unawaited(_cells.retry(_areas)),
        ),
      CellStatus.loading => ExploreNotice(message: context.t('Загружаем места…')),
      CellStatus.ready => null,
    };
  }

  Widget? _walksNotice(BuildContext context) {
    if (!_walksEnabled) return null;
    final snapshot = _overview.snapshot;
    if (snapshot.unavailable) return null;
    return switch (snapshot.status) {
      WalkOverviewStatus.error => ExploreNotice(
          message: context.t('Не удалось загрузить прогулки'),
          alert: true,
          retryLabel: context.t('Повторить загрузку прогулок'),
          onRetry: () => unawaited(_overview.retry()),
        ),
      WalkOverviewStatus.loading => ExploreNotice(message: context.t('Загружаем прогулки…')),
      _ => null,
    };
  }

  Widget? _geoNotice(BuildContext context) {
    if (_geoMessage.isEmpty) return null;
    return ExploreNotice(
      message: '$_geoMessage${_geoOutside ? ' ${context.t('Истории есть в городах:')}' : ''}',
      onClose: () => setState(() {
        _geoMessage = '';
        _geoOutside = false;
      }),
      children: [
        if (_geoOutside) CityChoices(onCity: _showCity),
        if (_geo == _Geo.denied) GeoHelp(onRetry: _locate, onOpenSettings: () => unawaited(_openSettings())),
      ],
    );
  }

  Widget? _linkNoticeWidget(BuildContext context) {
    if (_linkNotice.isEmpty) return null;
    final id = _linkedId;
    return ExploreNotice(
      message: context.t(_linkNotice),
      alert: _linkRetry,
      onRetry: _linkRetry && id != null
          ? () => setState(() {
                _linkNotice = 'Открываем историю…';
                _linkRetry = false;
                unawaited(_loadLinked(id));
              })
          : null,
      onClose: () => setState(() => _linkNotice = ''),
    );
  }

  List<MapWalk> get _visibleWalks {
    if (!_walksEnabled) return const [];
    final snapshot = _overview.snapshot;
    final area = _viewport?.buffered;
    if (snapshot.unavailable || area == null) return const [];
    return [for (final walk in snapshot.walks) if (walk.bounds.intersects(area)) walk];
  }

  Widget? _sheet(BuildContext context) {
    final panel = _panel;
    switch (panel) {
      case _NoPanel():
        return null;
      case _PromptPanel():
        return LocationPromptSheet(
          locating: _geo == _Geo.locating,
          failed: _geo == _Geo.error || _geo == _Geo.denied,
          onLocate: _locate,
          onDismiss: () => unawaited(_dismissPrompt()),
        );
      case _PlacePanel(:final id, :final expanded):
        final point = _point(id);
        final header = point == null && id == _linkedId ? _linkedHeader : null;
        // A linked place whose header is still loading: the notice says so, the card waits.
        if (point == null && header == null) return null;
        return ExplorePanel(
          maxHeightFactor: expanded ? 0.92 : 0.6,
          child: PlaceStoryCard(
            key: ValueKey('place:$id'),
            placeId: id,
            title: point?.title ?? header!.title,
            address: point?.address ?? header!.address,
            hasPhoto: point?.photo ?? false,
            expanded: expanded,
            onExpand: () => setState(() => _panel = _PlacePanel(id, expanded: true)),
            onCollapse: () => setState(() => _panel = _PlacePanel(id)),
            onClose: _close,
            onMissing: () => unawaited(_cells.revalidate()),
          ),
        );
      case _NearbyPanel(:final center):
        final snapshot = _cells.snapshot;
        final stories = [
          for (final point in snapshot.points)
            if (point.durationSec case final duration?)
              NearbyStory(
                id: point.id,
                title: point.title,
                address: point.address,
                location: point.location,
                durationSec: duration,
                sourceCount: point.sources,
                factCount: point.facts,
              ),
        ];
        return NearbySheet(
          status: areaStatus(snapshot, nearbyBounds(center, _nearbyRadius)),
          radius: _nearbyRadius,
          recommendations: recommendNearbyStories(center, _nearbyRadius, stories, translate: context.t),
          walks: _nearbyWalks,
          onRadius: (radius) {
            setState(() => _nearbyRadius = radius);
            _ensureCells();
          },
          onSelect: (id) => _selectPlace(id, focus: _point(id)?.location),
          onOpenWalk: (walk) => _openWalk(walk.location),
          onRetryWalks: () => _loadNearbyWalks(center, force: true),
          onClose: _close,
        );
      case _WalksPanel(:final keys, :final selected):
        final byKey = {for (final walk in _overview.snapshot.walks) walk.key: walk};
        final walks = [for (final key in keys) ?byKey[key]];
        if (walks.isEmpty) return null;
        return WalkOverviewSheet(
          walks: walks,
          selected: selected,
          onSelect: (key) => setState(() => _panel = _WalksPanel(keys, key)),
          onOpen: (walk) => _openWalk(walk.location),
          onClose: _close,
        );
      case _ClusterPanel(:final ids):
        final points = [for (final id in ids) ?_point(id)];
        if (points.isEmpty) return null;
        return ClusterListSheet(points: points, onSelect: (point) => _selectPlace(point.id), onClose: _close);
    }
  }

  @override
  Widget build(BuildContext context) {
    final geoControl = _geoControl(context);
    final selectedPlace = switch (_panel) {
      _PlacePanel(:final id) => id,
      _ => null,
    };
    final selectedWalks = switch (_panel) {
      _WalksPanel(:final keys, :final selected) => selected != null ? {selected} : keys.toSet(),
      _ => const <String>{},
    };
    final walksAvailable = !_overview.snapshot.unavailable;
    final notices = [
      _linkNoticeWidget(context),
      _geoNotice(context),
      _catalogNotice(context),
      _walksNotice(context),
    ].whereType<Widget>().toList();
    final sheet = _sheet(context);
    final user = _user;
    final settled = _geo == _Geo.ready && user != null;

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: ExploreMap(
              key: _map,
              initialCenter: _initialCenter,
              initialZoom: _initialZoom,
              clusters: _clusters,
              selectedPlaceId: selectedPlace,
              walks: _visibleWalks,
              selectedWalks: selectedWalks,
              // While the engine runs its puck shows the fixes; the app's dot takes over once settled.
              userPosition: settled ? GeoPoint(user.lat, user.lon) : null,
              userAccuracyM: settled ? user.accuracyM : null,
              locationSource: _fixSource,
              onViewport: _onViewport,
              onClusterTap: _onClusterTap,
              onWalksTap: _onWalksTap,
              onMapTap: _onMapTap,
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(TokenSizes.shellGutter),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final notice in notices) Padding(padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs), child: notice),
                      ],
                    ),
                  ),
                  const SizedBox(width: TokenSizes.spaceXs),
                  Column(children: [
                    _MapButton(
                      tooltip: geoControl.description,
                      icon: geoControl.icon,
                      busy: _geo == _Geo.locating,
                      onPressed: _geo == _Geo.locating ? null : _locate,
                    ),
                    if (walksAvailable) ...[
                      const SizedBox(height: TokenSizes.spaceXs),
                      _MapButton(
                        tooltip: context.t('Прогулки на карте'),
                        icon: Icons.route,
                        selected: _walksEnabled,
                        onPressed: () => unawaited(_toggleWalks()),
                      ),
                    ],
                  ]),
                ],
              ),
            ),
          ),
          if (sheet != null) Align(alignment: Alignment.bottomCenter, child: sheet),
        ],
      ),
    );
  }
}

/// A 48 dp round control over the map.
class _MapButton extends StatelessWidget {
  const _MapButton({required this.tooltip, required this.icon, required this.onPressed, this.selected, this.busy = false});

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;

  /// Non-null for a toggle.
  final bool? selected;
  final bool busy;

  @override
  Widget build(BuildContext context) => Semantics(
        toggled: selected,
        child: Material(
          color: selected == true ? TokenColors.mapGreen : TokenColors.surfaceIsland,
          shape: const CircleBorder(),
          elevation: 3,
          child: IconButton(
            tooltip: tooltip,
            constraints: const BoxConstraints.tightFor(width: TokenSizes.controlPrimaryMin, height: TokenSizes.controlPrimaryMin),
            onPressed: onPressed,
            icon: busy
                ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(icon, color: selected == true ? TokenColors.onDark : TokenColors.mapGreen),
          ),
        ),
      );
}
