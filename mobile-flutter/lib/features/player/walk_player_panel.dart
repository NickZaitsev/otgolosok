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
import '../../walk_engine/walk_plan.dart' show StopStage;
import '../../walk_engine/walk_session.dart';
import '../../walk_engine/walk_settings.dart';
import '../../walk_engine/walk_view.dart';
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
  const WalkPlayerPanel({required this.view, required this.link, this.localAudio = const {}, this.intro, super.key});

  final WalkView view;
  final WalkLink link;

  /// The walk's summary and tools, shown under the map before the start.
  final Widget? intro;

  /// Saved recordings by chapter id or site-relative URL (`file://`); preferred over streaming.
  final Map<String, Uri> localAudio;

  @override
  Widget build(BuildContext context) => view.document.driving
      ? CarWalkPanel(view: view, link: link, localAudio: localAudio, intro: intro)
      : _WalkPanel(view: view, link: link, localAudio: localAudio, intro: intro);
}

class _WalkPanel extends ConsumerStatefulWidget {
  const _WalkPanel({required this.view, required this.link, required this.localAudio, required this.intro});

  final WalkView view;
  final WalkLink link;
  final Map<String, Uri> localAudio;
  final Widget? intro;

  @override
  ConsumerState<_WalkPanel> createState() => _WalkPanelState();
}

class _WalkPanelState extends ConsumerState<_WalkPanel> {
  late WalkPlayerController _controller;
  late WalkLaunchReporter _reporter;
  late ProviderContainer _container;
  late AppLocale _locale;
  late WalkMapFraming _framing;

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
  }

  void _recreate() {
    final old = _controller;
    final reporter = _reporter;
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
    final sameWalk = old.view.document.id == widget.view.document.id &&
        old.link.location == widget.link.location &&
        old.view.locale == widget.view.locale;
    if (sameWalk) {
      _controller.updateView(widget.view, widget.localAudio);
    } else {
      _recreate();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _reporter.dispose();
    super.dispose();
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
    );
    return ref.watch(walkRouteMapProvider)(
      context,
      WalkMapProps(view: view, onSelect: _selectOnMap, label: context.t('Карта прогулки: пешеходный маршрут и остановки')),
    );
  }

  @override
  Widget build(BuildContext context) {
    // The controller reads the direction itself; this only redraws «Продолжить прогулку» and the stops.
    ref.watch(walkReversedProvider(widget.view.document.id));
    final controller = _controller;
    return ListenableBuilder(
      listenable: controller,
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
                child: state.active
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
