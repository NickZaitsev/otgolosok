// «Прогулка»: the walk builder screen (site walk-creation-panel.tsx over the explore map).
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/location/locate.dart';
import '../../core/location/walk_service_permissions.dart';
import '../../walk_engine/car_route.dart';
import '../../walk_engine/distance.dart';
import '../account/access_sheet.dart' as access;
import '../explore/catalog_bounds.dart';
import '../explore/cell_store.dart';
import '../explore/map_location_source.dart';
import 'builder_api.dart';
import 'builder_controller.dart';
import 'builder_map.dart';
import 'builder_storage.dart';
import 'messages.dart';
import 'model.dart';
import 'parking.dart';
import 'research_panel.dart';
import 'widgets.dart';

/// The location permission used by «Моё местоположение».
final builderLocationPermissionsProvider = Provider<LocationPermissions>((ref) => WalkServiceLocationPermissions());

/// Cached parking cells; only an accelerator, every failure counts as an empty cache.
final builderParkingStorageProvider = Provider<CellStorage>(
  (ref) => FileCellStorage(() async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}parking-cells-v1')),
);

enum _Picker { choices, address, time }

class BuilderScreen extends ConsumerStatefulWidget {
  /// [query] is the builder link's query: `local`, `id`, `resume`, or `address`+`lat`+`lon`.
  const BuilderScreen({super.key, this.query = const {}});

  final Map<String, String> query;

  @override
  ConsumerState<BuilderScreen> createState() => _BuilderScreenState();
}

class _BuilderScreenState extends ConsumerState<BuilderScreen> with WidgetsBindingObserver {
  late final _parsed = BuilderArgs.parse(widget.query);
  final _fixSource = MapFixSource();
  final _parkingCells = ParkingCells();
  BuilderController? _controller;
  CellStore<ParkingPlace>? _parking;
  MapViewport? _viewport;
  bool _parkingFailed = false;
  _Picker? _picker;
  EndpointMode? _chosenMode;
  bool _picking = false;
  bool _redirected = false;
  BuilderMapView? _view;
  List<Object?> _viewKey = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final args = _parsed.args;
    if (args == null) return;
    final store = ref.read(sessionStoreProvider);
    final settings = ref.read(settingsProvider);
    final controller = BuilderController(
      BuilderServices(
        api: ref.read(builderApiProvider),
        storage: ref.read(builderStorageProvider),
        walks: ref.read(deviceLocalWalkStoreProvider),
        session: () async {
          await store.refreshCsrf();
          return store.user;
        },
        preferredTravelMode: () => settings.prefersDriving ? TravelMode.driving : TravelMode.walking,
        locator: Locator(permissions: ref.read(builderLocationPermissionsProvider), source: _fixSource),
      ),
      args,
    );
    _controller = controller..addListener(_onChange);
    unawaited(controller.restore());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller
      ?..removeListener(_onChange)
      ..dispose();
    _parking
      ?..removeListener(_onChange)
      ..dispose();
    _fixSource.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_controller?.refreshOnFocus());
  }

  String get _here => Uri(path: '/builder', queryParameters: widget.query.isEmpty ? null : widget.query).toString();

  void _onChange() {
    if (!mounted) return;
    final controller = _controller;
    if (controller != null && controller.loginRequired && !_redirected) {
      _redirected = true;
      context.go(Uri(path: '/login', queryParameters: {'returnTo': _here}).toString());
      return;
    }
    if (controller != null && !controller.draft.driving) _parkingFailed = false;
    setState(() {});
  }

  BuilderController get _c => _controller!;

  bool get _busy => _c.busyNow;

  EndpointMode get _mode => _chosenMode ?? _c.initialMode;

  Future<void> _open(String location) async {
    if (mounted) await context.push(location);
  }

  Future<void> _onMapTap(GeoPoint point) async {
    final c = _c;
    if (!c.loaded || _busy || c.storageError != null) return;
    final target = _picking || _picker != null
        ? c.target
        : c.draft.start != null
            ? BuilderTarget.destination
            : BuilderTarget.start;
    final place = await c.resolve(point: point);
    if (place == null || !mounted) return;
    c.setTarget(target);
    if (target == BuilderTarget.destination) _chosenMode = EndpointMode.destination;
    if (c.draft.driving && target == BuilderTarget.stop) {
      c.setCandidate(place);
      _picker = _Picker.address;
    } else if (await c.selectAddress(place, target)) {
      _picker = null;
    }
    if (mounted) setState(() => _picking = false);
  }

  Future<void> _changeMode(EndpointMode next) async {
    setState(() => _chosenMode = next);
    await _c.edit(DraftChange(destination: const Value(null), mode: next == EndpointMode.time ? WalkMode.loop : WalkMode.open));
    _c.setTarget(BuilderTarget.destination);
  }

  Future<void> _resolveAddress(String query) async {
    final c = _c;
    final place = await c.resolve(query: query);
    if (place == null || !mounted || (c.draft.driving && c.target == BuilderTarget.stop)) return;
    if (await c.selectAddress(place) && mounted) setState(() => _picker = null);
  }

  Future<void> _cancelAddress() async {
    if (_c.target == BuilderTarget.destination) setState(() => _chosenMode = EndpointMode.destination);
    await _c.cancelAddress();
    if (mounted) setState(() => _picker = null);
  }

  Future<void> _confirmCandidate() async {
    if (await _c.confirmCandidate() && mounted) setState(() => _picker = null);
  }

  Future<void> _build() async {
    setState(() => _picker = null);
    final location = await _c.build();
    if (location != null) await _open(location);
  }

  Future<void> _openWalk() async {
    final location = await _c.openWalk();
    if (location != null) await _open(location);
  }

  Future<void> _saveToAccount() async {
    final outcome = await _c.saveToAccount();
    if (outcome == SaveOutcome.login && mounted) {
      await context.push(Uri(path: '/login', queryParameters: {'returnTo': '/builder?resume=1'}).toString());
    }
  }

  Future<void> _sharing() async {
    final walk = _c.serverWalk;
    if (walk == null) return;
    final changed = await access.showAccessSheet(context, walk);
    if (changed != null) _c.sharingChanged(changed);
  }

  Future<void> _download() async {
    try {
      await SharePlus.instance.share(ShareParams(text: _c.downloadText(), subject: 'otgolosok-walk.json'));
    } catch (error) {
      _c.setError(ErrorText(error, 'Не удалось скачать черновик.'));
    }
  }

  // Parking layer of car walks: cells around the view from zoom 14 on.
  void _onViewport(MapViewport viewport) {
    setState(() => _viewport = viewport);
    unawaited(_loadParking());
  }

  Future<void> _loadParking() async {
    final viewport = _viewport;
    if (_controller?.draft.driving != true || viewport == null || viewport.zoom < parkingMinZoom) return;
    final store = _parking ??= _parkingCells.store(
      fetch: apiCellFetch(ref.read(apiProvider)),
      storage: ref.read(builderParkingStorageProvider),
    )..addListener(_onChange);
    try {
      await store.ensureArea([viewport.required]);
    } catch (error) {
      if (mounted) setState(() => _parkingFailed = true);
    }
  }

  Future<void> _retryParking() async {
    final viewport = _viewport;
    final store = _parking;
    if (viewport == null || store == null) return;
    setState(() => _parkingFailed = false);
    try {
      await store.retry([viewport.required]);
    } catch (error) {
      if (mounted) setState(() => _parkingFailed = true);
    }
  }

  List<ParkingPlace> get _parkingPlaces {
    final viewport = _viewport, store = _parking;
    if (!_c.draft.driving || viewport == null || viewport.zoom < parkingMinZoom || store == null) return const [];
    return store.snapshot.points.where((place) => viewport.required.containsPoint(place.location)).toList();
  }

  static bool _sameKey(List<Object?> a, List<Object?> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!identical(a[i], b[i]) && a[i] != b[i]) return false;
    }
    return true;
  }

  BuilderMapView _mapView(BuildContext context) {
    final draft = _c.draft;
    final parking = _parkingPlaces;
    final key = [draft, _c.focus, _picking, context.appLocale, _parking?.snapshot, _viewport];
    final cached = _view;
    if (cached != null && _sameKey(key, _viewKey)) {
      return cached;
    }
    final route = draft.route, car = route?.car;
    _viewKey = key;
    return _view = BuilderMapView(
      markers: draftMarkers(draft, context.t),
      geometry: car == null ? route?.geometry : null,
      segments: [for (final segment in car?.segments ?? const <TravelSegment>[]) (driving: segment.mode == TravelSegmentMode.driving, geometry: segment.geometry)],
      tunnels: route?.tunnels,
      focus: _c.focus,
      picking: _picking,
      parking: parking,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return Scaffold(
        appBar: AppBar(title: Text(context.t('Прогулка'))),
        body: Padding(padding: const EdgeInsets.all(16), child: Notice(text: context.t(_parsed.error!), alert: true)),
      );
    }
    final mapBuilder = ref.watch(builderMapProvider);
    final driving = controller.draft.driving;
    return Scaffold(
      body: Stack(children: [
        Positioned.fill(
          child: mapBuilder(
            context,
            BuilderMapProps(view: _mapView(context), onTap: (point) => unawaited(_onMapTap(point)), onViewport: _onViewport, fixSource: _fixSource),
          ),
        ),
        if (driving) Positioned(top: MediaQuery.paddingOf(context).top + 8, left: 16, right: 16, child: _parkingStatus(context)),
        DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.2,
          maxChildSize: 0.95,
          builder: (context, scroll) => Material(
            color: TokenColors.surfaceIsland,
            elevation: 4,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(TokenSizes.radiusIsland)),
            child: Column(children: [
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  children: [_header(context), ..._body(context)],
                ),
              ),
              ?_footer(context),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _parkingStatus(BuildContext context) {
    final store = _parking, viewport = _viewport;
    final String? text;
    Widget? action;
    if (store?.snapshot.maintenance ?? false) {
      text = context.t('Парковки пока недоступны. Попробуйте позже.');
    } else if (viewport != null && viewport.zoom < parkingMinZoom) {
      text = context.t('Приблизьте карту, чтобы увидеть парковки');
    } else if (_parkingFailed || store?.snapshot.manifestStatus == ManifestStatus.error) {
      text = context.t('Не удалось загрузить парковки');
      action = TextButton(
        style: TextButton.styleFrom(minimumSize: const Size(TokenSizes.controlPrimaryMin, TokenSizes.controlPrimaryMin)),
        onPressed: _retryParking,
        child: Text(context.t('Повторить загрузку парковок')),
      );
    } else {
      text = null;
    }
    if (text == null) return const SizedBox.shrink();
    return Notice(text: text, action: action);
  }

  Widget _header(BuildContext context) {
    final title = _picking ? (_c.draft.driving ? 'Куда едем?' : 'Куда идём?') : 'Прогулка';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(header: true, child: Text(context.t(title), style: Theme.of(context).textTheme.headlineSmall)),
    );
  }

  List<Widget> _body(BuildContext context) {
    final c = _c;
    if (!c.loaded) return [Text(context.t('Открываем черновик…'))];
    final draft = c.draft;
    final built = draft.route != null && !_picking;
    return [
      if (c.storageError == null || draft.start != null || c.writable) ...[
        if (!_picking) ...[
          _travelMode(context),
          for (final target in const [BuilderTarget.start, BuilderTarget.destination]) ...[
            if (c.target == target && _picker == _Picker.address) _addressInput(context) else _endpoint(context, target),
            if (c.target == target) ?_pickerPanel(context),
          ],
          if (c.target == BuilderTarget.stop) ?_pickerPanel(context),
          if (c.target == BuilderTarget.stop && _picker == _Picker.address && c.candidate == null) _addressInput(context),
          if (draft.start != null && _picker == null)
            SecondaryButton(
              key: const ValueKey('add-stop'),
              label: context.t('Добавить остановку'),
              onPressed: _busy
                  ? null
                  : () {
                      c
                        ..setTarget(BuilderTarget.stop)
                        ..setCandidate(null);
                      setState(() => _picker = _Picker.choices);
                    },
            ),
        ],
        if (_picking)
          Section(children: [
            Text(context.t('Нажмите на карту в нужном месте.')),
            SecondaryButton(label: context.t('Отменить'), onPressed: () => setState(() => _picking = false)),
          ]),
        if (built && draft.stops.isNotEmpty) _stops(context),
        if (!draft.driving) ResearchPanel(controller: c, disabled: _busy || c.storageError != null, onOpen: (location) => unawaited(_open(location))),
        if (draft.submitting != null) _recovery(context),
        if (built) ..._account(context),
      ],
      if (c.storageError case final storageError?)
        Notice(
          key: const ValueKey('storage-error'),
          text: storageError.resolve(context),
          alert: true,
          action: TextButton(
            style: TextButton.styleFrom(minimumSize: const Size(TokenSizes.controlPrimaryMin, TokenSizes.controlPrimaryMin)),
            onPressed: _download,
            child: Text(context.t('Скачать черновик')),
          ),
        ),
      if (c.error case final error?) Notice(key: const ValueKey('error'), text: error.resolve(context), alert: true),
      if (c.message case final message?) Notice(key: const ValueKey('message'), text: message.resolve(context)),
      if (_busy)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(children: [
            const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 12),
            Expanded(child: Text(c.busy?.resolve(context) ?? context.t('Определяем местоположение…'), style: TextStyle(color: TokenColors.muted))),
          ]),
        ),
    ];
  }

  Widget _travelMode(BuildContext context) {
    final c = _c;
    return Section(children: [
      Text(context.t('Как передвигаемся'), style: TextStyle(color: TokenColors.muted)),
      SegmentedButton<TravelMode>(
        style: SegmentedButton.styleFrom(minimumSize: const Size(TokenSizes.controlPrimaryMin, TokenSizes.controlPrimaryMin)),
        segments: [
          ButtonSegment(value: TravelMode.walking, label: Text(context.t('Пешком'))),
          ButtonSegment(value: TravelMode.driving, label: Text(context.t('На машине'))),
        ],
        selected: {c.draft.travelMode},
        showSelectedIcon: false,
        onSelectionChanged: _busy ? null : (selection) => unawaited(c.changeTravelMode(selection.single)),
      ),
    ]);
  }

  String _endpointValue(BuildContext context, BuilderTarget target) {
    final draft = _c.draft;
    if (target == BuilderTarget.start) return draft.start?.address ?? context.t('Выберите начало');
    if (_mode == EndpointMode.time) {
      final source = draft.driving
          ? draft.mode == WalkMode.loop
              ? '{minutes} мин поездки · с возвращением'
              : '{minutes} мин поездки'
          : draft.mode == WalkMode.loop
              ? '{minutes} мин пешком · с возвращением'
              : '{minutes} мин пешком';
      return context.t(source, {'minutes': draft.minutes});
    }
    return draft.destination?.address ?? context.t('Выберите место или время');
  }

  Widget _endpoint(BuildContext context, BuilderTarget target) {
    final c = _c;
    final label = context.t(target == BuilderTarget.start ? 'Откуда' : 'Куда');
    final open = c.target == target && _picker != null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Semantics(
        button: true,
        expanded: open,
        label: label,
        child: InkWell(
          key: ValueKey('endpoint-${target.name}'),
          borderRadius: BorderRadius.circular(TokenSizes.radiusMd),
          onTap: _busy
              ? null
              : () {
                  final again = c.target == target && _picker != null;
                  c
                    ..setTarget(target)
                    ..setCandidate(null);
                  setState(() => _picker = again ? null : _Picker.choices);
                },
          child: Ink(
            decoration: BoxDecoration(
              color: TokenColors.controlSoft,
              borderRadius: BorderRadius.circular(TokenSizes.radiusMd),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      ExcludeSemantics(child: Text(label, style: TextStyle(color: TokenColors.muted, fontSize: TokenSizes.textMeta))),
                      Text(_endpointValue(context, target), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ]),
                  ),
                  Icon(open ? Icons.expand_less : Icons.expand_more, color: TokenColors.muted),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _addressInput(BuildContext context) {
    final c = _c;
    final draft = c.draft;
    final label = context.t(switch (c.target) {
      BuilderTarget.start => 'Откуда',
      BuilderTarget.destination => 'Куда',
      BuilderTarget.stop => 'Остановка',
    });
    return AddressInput(
      key: ValueKey('address-${c.target.name}'),
      label: label,
      initialValue: switch (c.target) {
        BuilderTarget.start => draft.start?.address ?? '',
        BuilderTarget.destination => draft.destination?.address ?? '',
        BuilderTarget.stop => '',
      },
      disabled: _busy,
      onResolve: _resolveAddress,
      onCancel: () => unawaited(_cancelAddress()),
    );
  }

  Widget? _pickerPanel(BuildContext context) {
    final c = _c;
    final picker = _picker;
    if (picker == null || (picker == _Picker.address && c.candidate == null)) return null;
    final draft = c.draft;
    return Section(key: const ValueKey('picker'), children: [
      if (picker == _Picker.choices) ...[
        SecondaryButton(
          label: context.t('Ввести адрес'),
          onPressed: () {
            if (c.target == BuilderTarget.destination) unawaited(_changeMode(EndpointMode.destination));
            setState(() => _picker = _Picker.address);
          },
        ),
        SecondaryButton(
          label: context.t('Выбрать на карте'),
          onPressed: () {
            if (c.target == BuilderTarget.destination) unawaited(_changeMode(EndpointMode.destination));
            setState(() {
              _picker = null;
              _picking = true;
            });
          },
        ),
        if (c.target == BuilderTarget.destination)
          SecondaryButton(
            label: context.t('По времени'),
            onPressed: () {
              if (_mode != EndpointMode.time) unawaited(_changeMode(EndpointMode.time));
              setState(() => _picker = _Picker.time);
            },
          )
        else
          SecondaryButton(
            label: context.t('Моё местоположение'),
            onPressed: () {
              setState(() => _picker = _Picker.address);
              c.locate();
            },
          ),
      ],
      if (c.candidate case final candidate?) ...[
        Text(candidate.address, style: const TextStyle(fontWeight: FontWeight.w600)),
        if (draft.driving && c.target == BuilderTarget.stop) ..._parkingChoice(context),
        PrimaryButton(label: context.t('Выбрать эту точку'), onPressed: c.parkingBusy ? null : () => unawaited(_confirmCandidate())),
      ],
      if (picker == _Picker.time) ...[
        Text(context.t(draft.driving ? 'Время поездки' : 'Время пешком'), style: TextStyle(color: TokenColors.muted)),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final minutes in minutesFor(draft.travelMode))
            ChoiceChip(
              key: ValueKey('minutes-$minutes'),
              label: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin - 16),
                child: Center(widthFactor: 1, child: Text(context.t('{minutes} мин', {'minutes': minutes}))),
              ),
              selected: draft.minutes == minutes,
              onSelected: _busy ? null : (_) => unawaited(c.edit(DraftChange(minutes: minutes))),
            ),
        ]),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(context.t('Вернуться к началу')),
          value: draft.mode == WalkMode.loop,
          onChanged: _busy ? null : (value) => unawaited(c.edit(DraftChange(mode: value ? WalkMode.loop : WalkMode.open))),
        ),
      ],
    ]);
  }

  List<Widget> _parkingChoice(BuildContext context) {
    final c = _c;
    final selected = c.parkingOptions.where((place) => place.id == c.parkingId).firstOrNull;
    return [
      DropdownButtonFormField<String>(
        key: ValueKey('parking-${c.parkingOptions.length}-${c.parkingId}'),
        initialValue: c.parkingId,
        isExpanded: true,
        decoration: InputDecoration(labelText: context.t('Парковка рядом')),
        items: [
          DropdownMenuItem(value: '', child: Text(context.t('Выбрать позже'))),
          for (final place in c.parkingOptions)
            DropdownMenuItem(
              value: place.id,
              child: Text('${place.name}${place.access == ParkingAccess.unknown ? context.t(' · доступ не проверен') : ''}', overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: c.parkingBusy ? null : (value) => c.setParkingId(value ?? ''),
      ),
      if (c.parkingBusy)
        Text(context.t('Ищем парковки…'))
      else if (c.parkingError case final error?)
        Notice(text: error.resolve(context), alert: true)
      else if (c.parkingId.isEmpty)
        Text(context.t('Парковка не выбрана. Маршрут попробует подобрать её автоматически.')),
      if (selected?.access == ParkingAccess.unknown)
        Notice(text: context.t('Доступ на парковку не проверен. Перед поездкой убедитесь, что она открыта для всех.'), alert: true),
    ];
  }

  Widget _stops(BuildContext context) {
    final c = _c;
    final draft = c.draft;
    final next = c.nextPlace;
    return ExpansionTile(
      key: const ValueKey('stops'),
      tilePadding: EdgeInsets.zero,
      minTileHeight: TokenSizes.controlPrimaryMin,
      title: Text(context.t('Остановки · {count}', {'count': draft.stops.length})),
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var index = 0; index < draft.stops.length; index++)
          Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text('${index + 1}. ${draft.stops[index].address}')),
        if (next != null) ...[
          CheckboxListTile(
            key: const ValueKey('consent'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: c.reviewed,
            onChanged: (value) => c.setReviewed(value ?? false),
            title: Text(context.t('Подготовить историю выбранной остановки с помощью ИИ. Факты будут проверены по источникам.')),
          ),
          SecondaryButton(
            label: context.t('Подготовить историю'),
            onPressed: _busy || !c.reviewed || c.activeJob != null || draft.submitting != null || c.storageError != null
                ? null
                : () => unawaited(c.prepareNext()),
          ),
        ],
        for (final job in draft.jobs) Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text(context.t('История: {address} →', {'address': job.place.address}))),
      ],
    );
  }

  Widget _recovery(BuildContext context) {
    final c = _c;
    return Section(key: const ValueKey('recovery'), children: [
      Notice(text: context.t('Результат отправки неизвестен. Введите ID истории из раздела запросов профиля.')),
      TextField(
        key: const ValueKey('recovery-id'),
        decoration: InputDecoration(labelText: context.t('ID истории')),
        onChanged: c.setRecoveryId,
        autocorrect: false,
      ),
      SecondaryButton(label: context.t('Восстановить'), onPressed: () => unawaited(c.recoverJob())),
    ]);
  }

  List<Widget> _account(BuildContext context) {
    final c = _c;
    final server = c.serverWalk;
    return [
      if (server == null)
        SecondaryButton(
          key: const ValueKey('save-account'),
          label: context.t('Сохранить в личном кабинете'),
          onPressed: _busy || c.storageError != null ? null : () => unawaited(_saveToAccount()),
        )
      else
        SecondaryButton(
          key: const ValueKey('sharing'),
          label: context.t('Доступ к прогулке'),
          onPressed: _busy ? null : () => unawaited(_sharing()),
        ),
    ];
  }

  Widget? _footer(BuildContext context) {
    final c = _c;
    if (!c.loaded) return null;
    final draft = c.draft;
    final built = draft.route != null && !_picking;
    final Widget button;
    if (built && c.openLocation != null) {
      button = PrimaryButton(
        key: const ValueKey('open-walk'),
        label: context.t('Открыть прогулку'),
        onPressed: _busy || c.storageError != null ? null : () => unawaited(_openWalk()),
      );
    } else if (!built && !_picking && draft.start != null && (_mode == EndpointMode.time || draft.destination != null)) {
      button = PrimaryButton(
        key: const ValueKey('build-walk'),
        label: context.t('Построить прогулку'),
        onPressed: _busy || (_mode == EndpointMode.destination && draft.destination == null) || c.candidate != null || c.storageError != null
            ? null
            : () => unawaited(_build()),
      );
    } else {
      return null;
    }
    return SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: SizedBox(width: double.infinity, child: button)));
  }
}

/// The inline address field (site address-input.tsx): at least three characters, at most 180.
class AddressInput extends StatefulWidget {
  const AddressInput({super.key, required this.label, required this.initialValue, required this.onResolve, required this.onCancel, this.disabled = false});

  final String label;
  final String initialValue;
  final Future<void> Function(String query) onResolve;
  final VoidCallback onCancel;
  final bool disabled;

  @override
  State<AddressInput> createState() => _AddressInputState();
}

class _AddressInputState extends State<AddressInput> {
  late final _text = TextEditingController(text: widget.initialValue);
  bool _pending = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _ready => !widget.disabled && _text.text.trim().length >= 3;

  Future<void> _submit() async {
    if (!_ready || _pending) return;
    _pending = true;
    try {
      await widget.onResolve(_text.text.trim());
    } finally {
      _pending = false;
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: TextField(
              key: const ValueKey('address-field'),
              controller: _text,
              enabled: !widget.disabled,
              autofocus: true,
              maxLength: 180,
              textInputAction: TextInputAction.done,
              keyboardType: TextInputType.streetAddress,
              autofillHints: const [AutofillHints.fullStreetAddress],
              decoration: InputDecoration(labelText: widget.label, hintText: context.t('Улица и номер дома'), counterText: ''),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => unawaited(_submit()),
            ),
          ),
          IconButton(
            key: const ValueKey('address-submit'),
            constraints: const BoxConstraints(minWidth: TokenSizes.controlPrimaryMin, minHeight: TokenSizes.controlPrimaryMin),
            tooltip: context.t('Подтвердить адрес'),
            onPressed: _ready ? () => unawaited(_submit()) : null,
            icon: const Icon(Icons.check),
          ),
          IconButton(
            constraints: const BoxConstraints(minWidth: TokenSizes.controlPrimaryMin, minHeight: TokenSizes.controlPrimaryMin),
            tooltip: context.t('Отменить ввод: {label}', {'label': widget.label}),
            onPressed: widget.disabled ? null : widget.onCancel,
            icon: const Icon(Icons.close),
          ),
        ]),
      );
}
