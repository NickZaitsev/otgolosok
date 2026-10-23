import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/i18n/user_message.dart';
import '../../walk_engine/walk_plan.dart' show StopStage;
import '../../walk_engine/walk_session.dart';
import '../../walk_engine/walk_settings.dart';
import '../../walk_engine/walk_view.dart';
import '../explore/map_layers.dart' show MapMarker, MapMarkerKind;
import '../food/food_kinds.dart';
import '../food/food_list.dart';
import '../food/food_model.dart';
import '../food/food_store.dart';
import '../food/route_proximity.dart';
import '../food/walk_food.dart';
import '../walks/launches.dart';
import '../walks/route_map.dart';
import '../walks/walk_link.dart';
import '../walks/walk_screen.dart' show reviewTargetOf;
import 'audio_controls.dart';
import 'car/car_walk_panel.dart';
import 'historical_photos.dart';
import 'permission_sheet.dart';
import 'providers.dart';
import 'replay_source.dart';
import 'takeover_dialog.dart';
import 'walk_map_framing.dart';
import 'walk_drawers.dart';
import 'walk_player_controller.dart';

/// The listening panel of a loaded walk: binds the walk engine to the native walk service.
/// A car walk gets its own panel (parkings, stories only after parking).
class WalkPlayerPanel extends StatelessWidget {
  const WalkPlayerPanel({required this.view, required this.link, this.localAudio = const {}, this.intro, this.mount, this.onAddFood, super.key});

  final WalkView view;
  final WalkLink link;

  /// The walk's summary and tools, shown under the map before the start.
  final Widget? intro;

  /// Saved recordings by chapter id or site-relative URL (`file://`); preferred over streaming.
  final Map<String, Uri> localAudio;

  /// The load the walk came from: while it stays the same, a new link (a copy saved with a food place) keeps
  /// the running walk.
  final String? mount;

  /// Adds a food place to the walk and returns a notice about where the walk was saved (empty when it changed in
  /// place); null where places cannot join the walk.
  final AddFood? onAddFood;

  @override
  Widget build(BuildContext context) => view.document.driving
      ? CarWalkPanel(view: view, link: link, localAudio: localAudio, intro: intro)
      : _WalkPanel(view: view, link: link, localAudio: localAudio, intro: intro, mount: mount, onAddFood: onAddFood);
}

typedef AddFood = Future<String> Function(FoodPlace place);

class _WalkPanel extends ConsumerStatefulWidget {
  const _WalkPanel({required this.view, required this.link, required this.localAudio, required this.intro, required this.mount, required this.onAddFood});

  final WalkView view;
  final WalkLink link;
  final Map<String, Uri> localAudio;
  final Widget? intro;
  final String? mount;
  final AddFood? onAddFood;

  @override
  ConsumerState<_WalkPanel> createState() => _WalkPanelState();
}

class _WalkPanelState extends ConsumerState<_WalkPanel> {
  late WalkPlayerController _controller;
  late WalkLaunchReporter _reporter;
  late ProviderContainer _container;
  late AppLocale _locale;
  late WalkMapFraming _framing;
  late final WalkFood _food = WalkFood(store: ref.read(foodStoreProvider), cells: ref.read(foodCellsProvider));

  // «Поесть рядом»: the list replaces the panel body while open.
  bool _foodOpen = false;
  String? _foodSelected;
  String? _foodPending;
  String _foodStatus = '';
  MapFit? _foodFit;
  List<RouteFoodPlace>? _foodMarkersFor;
  List<MapMarker> _foodMarkers = const [];

  @override
  void initState() {
    super.initState();
    _container = ProviderScope.containerOf(context, listen: false);
    _locale = ref.read(localeProvider);
    _create();
  }

  void _create() {
    _framing = WalkMapFraming();
    _reporter = WalkLaunchReporter(ref.read(apiProvider), reviewTargetOf(widget.link));
    _controller = WalkPlayerController(
      view: widget.view,
      link: widget.link,
      hub: ref.read(walkServiceHubProvider),
      settings: ref.read(settingsProvider),
      origin: ref.read(configProvider).origin,
      translations: ref.read(translationsProvider),
      locale: _locale,
      localAudio: widget.localAudio,
      reportLaunch: _reporter.call,
      onActiveChanged: publishWalkActive(_container),
    );
    _controller.addListener(_syncFood);
    _syncFood();
  }

  /// The food list follows the route: a changed walk or the other direction moves its places and stops.
  void _syncFood() {
    final controller = _controller;
    _food.setRoute(
      controller.route.walk?.path.coordinates ?? const [],
      [for (final chapter in controller.chapters) chapter.arrivalPoint],
      widget.view.document.mode,
    );
    if (controller.state.completed && _foodOpen) _closeFood();
  }

  void _recreate() {
    final old = _controller;
    final reporter = _reporter;
    old.removeListener(_syncFood);
    _create();
    old.dispose();
    reporter.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = context.appLocale;
    if (locale == _locale) return;
    _locale = locale;
    // The language switch asked first: the walk ends with its place saved, and continues in the
    // new language once the walk screen reloads the view.
    _controller.localeChanged(locale);
    _recreate();
  }

  @override
  void didUpdateWidget(_WalkPanel old) {
    super.didUpdateWidget(old);
    final mount = widget.mount;
    final sameWalk = old.view.locale == widget.view.locale &&
        (mount != null && mount == old.mount ||
            old.view.document.id == widget.view.document.id && old.link.location == widget.link.location);
    if (sameWalk) {
      _controller.updateView(widget.view, widget.localAudio, link: widget.link);
    } else {
      _recreate();
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_syncFood);
    _controller.dispose();
    _reporter.dispose();
    _food.dispose();
    super.dispose();
  }

  // ---- «Поесть рядом» -------------------------------------------------------------------------------

  void _toggleFood() {
    if (_foodOpen) {
      _closeFood();
      return;
    }
    setState(() {
      _foodOpen = true;
      _foodSelected = null;
      _foodStatus = '';
      _foodFit = null;
    });
    _food.setVisible(true);
  }

  void _closeFood() {
    setState(() {
      _foodOpen = false;
      _foodSelected = null;
      _foodFit = null;
    });
    _food.setVisible(false);
  }

  void _openFood(RouteFoodPlace place) {
    final nearest = _food.routePoint(place);
    setState(() {
      _foodOpen = true;
      _foodSelected = place.id;
      _foodFit = MapFit('food:${place.id}', [place.place.location, ?nearest]);
    });
    _food.setVisible(true);
  }

  void _foodOnMap(String id) {
    final place = _food.places.where((place) => place.id == id).firstOrNull;
    if (place != null) _openFood(place);
  }

  /// A place that joined the walk is one of its stops, matched by its exact coordinates.
  bool _foodAdded(FoodPlace place) => _controller.chapters.any((chapter) => chapter.location == place.location);

  Future<void> _addFood(RouteFoodPlace place) async {
    final add = widget.onAddFood;
    if (add == null || _foodPending != null) return;
    setState(() {
      _foodPending = place.id;
      _foodStatus = '';
    });
    String status;
    try {
      final notice = await add(place.place);
      if (!mounted) return;
      status = [context.t('«{name}» добавлено в прогулку.', {'name': place.place.name}), if (notice.isNotEmpty) notice].join(' ');
    } on Object catch (error) {
      if (!mounted) return;
      if (error is! Exception) debugPrint('Adding a food place failed: $error');
      status = userMessage(context, error, 'Не удалось добавить заведение в прогулку.');
    }
    setState(() {
      _foodPending = null;
      _foodStatus = status;
    });
  }

  List<MapMarker> get _foodMapMarkers {
    if (!_foodOpen) return const [];
    final places = _food.places;
    if (!identical(places, _foodMarkersFor)) {
      _foodMarkersFor = places;
      _foodMarkers = [
        for (final place in places)
          MapMarker(id: place.id, kind: MapMarkerKind.food, location: place.place.location, icon: foodGroup(place.place.kind).mapImage),
      ];
    }
    return _foodMarkers;
  }

  Widget _foodList(WalkUiState state) {
    final manifest = _food.manifest!;
    final places = _food.places;
    final add = widget.onAddFood;
    return WalkFoodList(
      places: places,
      stops: _food.stopsAlongM,
      active: state.active,
      fromM: _food.fromM(state.leg),
      selected: places.where((place) => place.id == _foodSelected).firstOrNull,
      onSelect: _openFood,
      onBack: () => setState(() {
        _foodSelected = null;
        _foodFit = null;
      }),
      onClose: _closeFood,
      manifest: manifest,
      hours: _food.hours,
      error: _food.error,
      loading: _food.loading,
      onRetry: () => unawaited(_food.retry()),
      adding: add == null
          ? null
          : FoodAdding(isAdded: _foodAdded, onAdd: (place) => unawaited(_addFood(place)), pending: _foodPending, status: _foodStatus),
    );
  }

  Future<void> _start({int? index, bool resume = true}) async {
    final controller = _controller;
    final permissions = await controller.checkPermissions();
    if (!mounted) return;
    // Unknown permissions (the check failed): the service reports the real status after the start.
    var granted = permissions == null || permissions.location == ws.PermissionStatus.granted;
    if (permissions != null && needsExplainer(permissions, ref.read(settingsProvider))) {
      final outcome = await showPermissionExplainer(
        context,
        permissions: permissions,
        request: controller.requestPermissions,
        check: controller.checkPermissions,
        openSettings: controller.openAppSettings,
        settings: ref.read(settingsProvider),
      );
      if (outcome.choice == PermissionChoice.cancel || !mounted) return;
      granted = outcome.locationGranted;
    }
    final other = ref.read(walkServiceHubProvider).owner;
    if (other != null && !identical(other, controller)) {
      if (!await confirmTakeover(context, current: other.ownerKind) || !mounted) return;
    }
    await controller.start(index: index, resume: resume, locationGranted: granted);
  }

  Future<void> _confirmStop() async {
    if (await confirmStopWalk(context)) _controller.stop();
  }

  /// A stop tapped on the map: during the walk it becomes the current stop, before the start
  /// «Остановки» opens (site `WalkSession` map `onSelect`).
  void _selectOnMap(String id) {
    final controller = _controller;
    final index = controller.chapters.indexWhere((chapter) => chapter.id == id);
    if (index < 0) return;
    if (controller.state.active) {
      controller.selectChapter(index);
    } else {
      unawaited(showStopsDrawer(context, controller));
    }
  }

  Widget _map(BuildContext context) {
    final controller = _controller;
    final fromStop = widget.link.fromStop;
    final view = _framing.view(
      route: controller.route,
      chapters: controller.chapters,
      state: controller.state,
      openingIndex: fromStop == null ? 0 : math.max(0, controller.chapters.indexWhere((chapter) => chapter.id == fromStop)),
      t: (source, values) => context.t(source, values),
      food: _foodMapMarkers,
      selectedFood: _foodOpen ? _foodSelected : null,
      foodFit: _foodOpen && _foodSelected != null ? _foodFit : null,
    );
    final map = ref.watch(walkRouteMapProvider)(
      context,
      WalkMapProps(view: view, onSelect: _selectOnMap, onFood: _foodOnMap, label: context.t('Карта прогулки: пешеходный маршрут и остановки')),
    );
    final completed = controller.state.completed;
    final showButton = _food.available && _food.manifest != null && !completed;
    final failed = !showButton && _food.manifestError && !completed;
    if (!showButton && !failed) return map;
    return Stack(children: [
      Positioned.fill(child: map),
      Positioned(
        top: TokenSizes.spaceXs,
        right: TokenSizes.spaceXs,
        left: failed ? TokenSizes.spaceXs : null,
        child: showButton
            ? Semantics(
                expanded: _foodOpen,
                child: Material(
                  color: _foodOpen ? TokenColors.mapGreen : TokenColors.surfaceIsland,
                  shape: const CircleBorder(),
                  elevation: 3,
                  child: IconButton(
                    tooltip: context.t('Поесть рядом'),
                    onPressed: _toggleFood,
                    icon: Icon(Icons.local_cafe, color: _foodOpen ? TokenColors.onDark : TokenColors.mapGreen),
                  ),
                ),
              )
            : Material(
                color: TokenColors.surfaceIsland,
                borderRadius: BorderRadius.circular(TokenSizes.radiusIsland),
                elevation: 3,
                child: Padding(
                  padding: const EdgeInsets.only(left: TokenSizes.spaceSm),
                  child: Semantics(
                    liveRegion: true,
                    child: Row(children: [
                      Expanded(child: Text(context.t('Не удалось загрузить заведения'))),
                      TextButton(onPressed: () => unawaited(_food.retry()), child: Text(context.t('Повторить'))),
                    ]),
                  ),
                ),
              ),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    // The controller reads the direction itself; this only redraws «Продолжить прогулку» and the stops.
    ref.watch(walkReversedProvider(widget.view.document.id));
    final controller = _controller;
    return ListenableBuilder(
      listenable: Listenable.merge([controller, _food]),
      builder: (context, _) {
        final state = controller.state;
        return PopScope(
          // Back during a walk asks first, like the site's cross.
          canPop: !state.active,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) unawaited(_confirmStop());
          },
          child: LayoutBuilder(
            builder: (context, constraints) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SizedBox(height: (constraints.maxHeight * 0.42).clamp(160.0, 420.0), child: _map(context)),
              Expanded(
                child: _foodOpen && !state.completed && _food.manifest != null
                    ? _foodList(state)
                    : state.active
                    ? _ActiveWalk(controller: controller, onStop: _confirmStop)
                    : state.completed
                        ? const _Completed()
                        : _BeforeStart(controller: controller, onStart: _start, intro: widget.intro),
              ),
            ]),
          ),
        );
      },
    );
  }
}

class _BeforeStart extends StatelessWidget {
  const _BeforeStart({required this.controller, required this.onStart, required this.intro});

  final WalkPlayerController controller;
  final Future<void> Function({int? index, bool resume}) onStart;
  final Widget? intro;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    final error = controller.error;
    final resume = controller.resumable;
    final resumeIndex = controller.resumeIndex;
    final chapters = controller.chapters;
    return ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
      if (intro case final intro?) ...[intro, const SizedBox(height: TokenSizes.spaceSm)],
      if (!state.canStart)
        Semantics(
          liveRegion: true,
          child: Text(
            context.t('В этой прогулке ещё нет маршрута. Постройте его в редакторе из истории.'),
            style: const TextStyle(color: TokenColors.alertInk),
          ),
        ),
      if (resume && resumeIndex >= 0 && resumeIndex < chapters.length)
        Padding(
          padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
          child: Text(
            context.t('Остановка {number}: {title}', {'number': resumeIndex + 1, 'title': chapters[resumeIndex].title}),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      if (error != null) ...[
        Semantics(liveRegion: true, child: Text(context.t(error), style: const TextStyle(color: TokenColors.dangerInk))),
        const SizedBox(height: TokenSizes.spaceXs),
      ],
      FilledButton.icon(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(TokenSizes.controlPrimaryMin)),
        onPressed: !state.canStart || controller.starting ? null : () => unawaited(onStart()),
        icon: controller.starting
            ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.arrow_forward),
        label: Text(controller.starting
            ? context.t('Запускаем…')
            : error != null
                ? context.t('Повторить')
                : resume
                    ? context.t('Продолжить прогулку')
                    : context.t('Начать прогулку')),
      ),
      if (resume && state.canStart)
        TextButton(
          onPressed: controller.starting ? null : () => unawaited(onStart(index: 0, resume: false)),
          child: Text(context.t('Начать с первой остановки')),
        ),
    ]);
  }
}

class _Completed extends StatelessWidget {
  const _Completed();

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
        Semantics(
          header: true,
          liveRegion: true,
          child: Text(context.t('Прогулка завершена'), style: Theme.of(context).textTheme.headlineSmall),
        ),
        const SizedBox(height: TokenSizes.spaceMd),
        FilledButton(onPressed: () => context.go('/'), child: Text(context.t('На карту'))),
      ]);
}

class _ActiveWalk extends StatelessWidget {
  const _ActiveWalk({required this.controller, required this.onStop});

  final WalkPlayerController controller;
  final Future<void> Function() onStop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = controller.state;
    final chapters = controller.chapters;
    final index = state.chapterIndex;
    final chapter = index >= 0 && index < chapters.length ? chapters[index] : null;
    final hasText = chapter?.content.story.paragraphs.isNotEmpty ?? false;
    final heading = chapter?.title ?? controller.route.walk?.finish.address ?? context.t('Прогулка');
    final meta = chapter == null
        ? context.t('До финиша')
        : state.stage == StopStage.approach && state.effectiveAdvance == AdvanceMode.place && chapter.audio != null
            ? context.t('Начнётся, когда подойдёте')
            : '';
    final locationLabel = state.positionFailed
        ? context.t('Геопозиции нет')
        : state.lastFix != null
            ? context.t('Положение определено')
            : context.t('Определяем положение…');
    final tone = switch (state.signalTone) {
      SignalTone.good => TokenColors.teal,
      SignalTone.warning => TokenColors.warningMark,
      SignalTone.neutral => TokenColors.muted,
    };
    final distance = state.distanceM;
    final label = context.t(walkAudioLabel(state));
    final following = state.nextStopTitle;
    final error = controller.error;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, 0), children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (meta.isNotEmpty) Text(meta, style: theme.textTheme.bodySmall),
                _LocationLine(
                  label: locationLabel,
                  tone: tone,
                  failed: state.positionFailed,
                  onTap: state.positionFailed ? () => unawaited(showPositionDrawer(context, controller)) : null,
                ),
                GestureDetector(
                  // A hidden toggle for the diagnostics in debug builds only (site `?debug=1`).
                  onLongPress: kDebugMode ? controller.toggleDiagnostics : null,
                  child: Semantics(header: true, child: Text(heading, style: theme.textTheme.headlineSmall)),
                ),
              ]),
            ),
            IconButton(
              tooltip: context.t('Прервать прогулку'),
              icon: const Icon(Icons.close),
              onPressed: () => unawaited(onStop()),
            ),
          ]),
          const SizedBox(height: TokenSizes.spaceXs),
          Semantics(
            liveRegion: true,
            child: Text(
              [
                context.t(state.statusText.key, state.statusText.values),
                if (distance != null && distance.isFinite) context.t('{distance} м', {'distance': distance.round()}),
              ].join(' · '),
              style: theme.textTheme.bodySmall?.copyWith(color: tone),
            ),
          ),
          if (state.audioUrl != null) ...[
            const SizedBox(height: TokenSizes.spaceXs),
            AudioControls(
              position: state.positionSec,
              duration: state.durationSec,
              canSeek: state.canSeek,
              playing: state.audioStatus == WalkAudioStatus.playing,
              label: label,
              caption: state.audioStatus == WalkAudioStatus.error ? context.t('Повторить') : null,
              rate: state.rate,
              onRate: controller.cycleRate,
              onToggle: controller.toggle,
              onSeek: controller.seekTo,
            ),
          ],
          if (state.audioStatus == WalkAudioStatus.error)
            Semantics(
              liveRegion: true,
              child: Text(
                context.t('Не удалось включить аудио. Нажмите «Повторить запуск звука».'),
                style: const TextStyle(color: TokenColors.dangerInk),
              ),
            ),
          if (chapter != null && chapter.audio == null && !hasText)
            Text(context.t('Без истории'), style: theme.textTheme.bodySmall?.copyWith(color: TokenColors.muted)),
          if (error != null)
            Semantics(liveRegion: true, child: Text(context.t(error), style: const TextStyle(color: TokenColors.dangerInk))),
          if (controller.notificationsBlocked) _NotificationHint(onSettings: controller.openAppSettings),
          const SizedBox(height: TokenSizes.spaceXs),
          Wrap(spacing: TokenSizes.spaceXs, runSpacing: TokenSizes.spaceXs, children: [
            if (chapters.isNotEmpty)
              OutlinedButton.icon(
                icon: const Icon(Icons.format_list_numbered),
                onPressed: () => unawaited(showStopsDrawer(context, controller)),
                label: Text(chapter != null
                    ? context.t('Остановка {current} из {total}', {'current': index + 1, 'total': chapters.length})
                    : context.t('Остановки · {count}', {'count': chapters.length})),
              ),
            if (hasText)
              OutlinedButton.icon(
                icon: const Icon(Icons.menu_book_outlined),
                onPressed: () => unawaited(showStoryDrawer(context, controller)),
                label: Text(context.t('Читать историю')),
              ),
            if (chapter != null) HistoricalPhotosButton(walkId: controller.route.id, stopId: chapter.id),
            Semantics(
              label: context.t('Настройки прогулки'),
              button: true,
              excludeSemantics: true,
              child: OutlinedButton.icon(
                icon: const Icon(Icons.tune),
                onPressed: () => unawaited(showSettingsDrawer(context, controller)),
                label: Text(context.t('Настройки')),
              ),
            ),
          ]),
          if (controller.diagnosticsVisible) _Diagnostics(controller: controller),
          const SizedBox(height: TokenSizes.spaceSm),
        ]),
      ),
      Material(
        color: TokenColors.raised,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, TokenSizes.spaceSm),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (following != null)
              Padding(
                padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
                child: Text(
                  context.t('Дальше: {title}', {'title': following}),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
              ),
            Row(children: [
              if (state.hasPrevious)
                IconButton.outlined(
                  tooltip: context.t('Предыдущая остановка'),
                  icon: const Icon(Icons.arrow_back),
                  onPressed: controller.previous,
                ),
              const SizedBox(width: TokenSizes.spaceXs),
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(TokenSizes.controlPrimaryMin)),
                  iconAlignment: IconAlignment.end,
                  icon: const Icon(Icons.arrow_forward),
                  onPressed: controller.next,
                  label: Text(switch (state.nextAction) {
                    NextAction.next => context.t('Дальше'),
                    NextAction.toFinish => context.t('К финишу'),
                    NextAction.finish => context.t('Завершить'),
                  }),
                ),
              ),
            ]),
          ]),
        ),
      ),
    ]);
  }
}

class _LocationLine extends StatelessWidget {
  const _LocationLine({required this.label, required this.tone, required this.failed, this.onTap});

  final String label;
  final Color tone;
  final bool failed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final line = Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(color: tone, shape: BoxShape.circle)),
      const SizedBox(width: 6),
      Flexible(child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
    ]);
    if (onTap == null) return Semantics(liveRegion: true, child: line);
    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: line),
      ),
    );
  }
}

/// Lock-screen controls are missing without notifications: the walk still works on the screen.
class _NotificationHint extends StatelessWidget {
  const _NotificationHint({required this.onSettings});

  final Future<void> Function() onSettings;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: TokenSizes.spaceXs),
        padding: const EdgeInsets.all(TokenSizes.spaceSm),
        decoration: BoxDecoration(color: TokenColors.warningSurface, borderRadius: BorderRadius.circular(TokenSizes.radiusSm)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            context.t('Уведомления выключены: управлять прогулкой с экрана блокировки не получится. Включите их в настройках телефона.'),
            style: const TextStyle(color: TokenColors.warningInk),
          ),
          TextButton(onPressed: () => unawaited(onSettings()), child: Text(context.t('Открыть настройки'))),
        ]),
      );
}

/// Debug builds only: the position pipeline and a recorded track instead of GPS.
class _Diagnostics extends StatelessWidget {
  const _Diagnostics({required this.controller});

  final WalkPlayerController controller;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    final fix = state.lastFix;
    final distance = state.distanceM;
    String metres(double? value) => value == null ? '—' : context.t('{distance} м', {'distance': value.round()});
    final rows = [
      (context.t('Геопозиция'), state.positionStatus.name),
      (context.t('Точность'), metres(fix?.accuracyM)),
      (context.t('До точки'), metres(distance)),
      (context.t('Триггер'), state.triggerPhase.name),
      (context.t('Переход'), context.t(advanceModeLabels[state.effectiveAdvance]!)),
      (context.t('Аудио'), state.audioStatus.name),
    ];
    return Card(
      margin: const EdgeInsets.only(top: TokenSizes.spaceSm),
      child: Padding(
        padding: const EdgeInsets.all(TokenSizes.spaceSm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(context.t('Диагностика'), style: Theme.of(context).textTheme.titleSmall),
          for (final (name, value) in rows) Text('$name: $value'),
          Wrap(spacing: TokenSizes.spaceXs, children: [
            if (controller.replayRunning)
              OutlinedButton(onPressed: controller.stopReplay, child: Text(context.t('Остановить')))
            else ...[
              OutlinedButton(onPressed: () => controller.startReplay(ReplayMode.walk), child: Text(context.t('Тестовый трек'))),
              OutlinedButton(
                onPressed: () => controller.startReplay(ReplayMode.walk, speed: 10),
                child: Text(context.t('Тестовый трек · ×{speed}', {'speed': 10})),
              ),
            ],
          ]),
        ]),
      ),
    );
  }
}
