import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/providers.dart';
import '../../../app/theme/tokens.g.dart';
import '../../../core/i18n/i18n.dart';
import '../../../core/i18n/translations.dart';
import '../../../walk_engine/distance.dart';
import '../../../walk_engine/driving_plan.dart';
import '../../../walk_engine/js_json.dart';
import '../../../walk_engine/walk_view.dart';
import '../../walks/launches.dart';
import '../../walks/route_map.dart';
import '../../walks/walk_link.dart';
import '../../walks/walk_screen.dart' show reviewTargetOf;
import '../audio_controls.dart';
import '../providers.dart';
import '../story_view.dart';
import '../takeover_dialog.dart';
import '../walk_map_framing.dart';
import 'car_walk_controller.dart';

/// Site `yandexNavigationUrl`: a route to [target] by car (`auto`) or on foot (`pd`).
Uri yandexNavigationUrl(GeoPoint target, {required bool driving}) => Uri.https('yandex.ru', '/maps/', {
      'rtext': '~${target.lat},${target.lon}',
      'rtt': driving ? 'auto' : 'pd',
    });

/// Site `parkingFeeLabel`.
String parkingFeeLabel(bool? fee) => switch (fee) {
      true => 'Парковка платная',
      false => 'Парковка бесплатная',
      null => 'Плата за парковку неизвестна',
    };

/// A car walk: parkings, drives and stories on foot (site `DrivingSheet`).
class CarWalkPanel extends ConsumerStatefulWidget {
  const CarWalkPanel({super.key, required this.view, required this.link, this.localAudio = const {}, this.intro});

  final WalkView view;
  final WalkLink link;
  final Map<String, Uri> localAudio;

  /// The walk's summary and tools, shown under the map at the overview.
  final Widget? intro;

  @override
  ConsumerState<CarWalkPanel> createState() => _CarWalkPanelState();
}

class _CarWalkPanelState extends ConsumerState<CarWalkPanel> {
  late CarWalkController _controller;
  late WalkLaunchReporter _reporter;
  late ProviderContainer _container;
  late AppLocale _locale;
  bool _linkFailed = false;
  late CarMapFraming _framing;

  @override
  void initState() {
    super.initState();
    _container = ProviderScope.containerOf(context, listen: false);
    _locale = ref.read(localeProvider);
    _create();
  }

  void _create() {
    _framing = CarMapFraming();
    _reporter = WalkLaunchReporter(ref.read(apiProvider), reviewTargetOf(widget.link));
    _controller = CarWalkController(
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
    // The trip's progress is saved on every step: a new language only restarts the story audio.
    _locale = locale;
    _recreate();
  }

  @override
  void didUpdateWidget(CarWalkPanel old) {
    super.didUpdateWidget(old);
    if (!identical(old.view, widget.view) || old.link.location != widget.link.location || old.localAudio != widget.localAudio) {
      _recreate();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _reporter.dispose();
    super.dispose();
  }

  Future<void> _toggleAudio() async {
    final other = ref.read(walkServiceHubProvider).owner;
    if (other != null && !identical(other, _controller)) {
      if (!await confirmTakeover(context, current: other.ownerKind) || !mounted) return;
    }
    await _controller.toggle();
  }

  Future<void> _navigate(GeoPoint target, {required bool driving}) async {
    var opened = false;
    try {
      opened = await launchUrl(yandexNavigationUrl(target, driving: driving), mode: LaunchMode.externalApplication);
    } on Object {
      opened = false;
    }
    if (mounted) setState(() => _linkFailed = !opened);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _controller,
        builder: (context, _) => _sheet(context),
      );

  Widget _sheet(BuildContext context) {
    final controller = _controller;
    final car = controller.car;
    final theme = Theme.of(context);
    final document = widget.view.document;
    if (car == null) {
      return ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
        Semantics(header: true, child: Text(context.t('Автомобильная прогулка'), style: theme.textTheme.titleLarge)),
        Semantics(
          liveRegion: true,
          child: Text(context.t('В этой прогулке ещё нет маршрута. Постройте его в редакторе из истории.'),
              style: const TextStyle(color: TokenColors.alertInk)),
        ),
      ]);
    }
    final state = controller.state;
    final visit = controller.visit;
    final chapter = controller.chapter;
    var eyebrow = context.t('Автомобильная прогулка');
    var heading = document.title.trim().isEmpty ? context.t('Ваш маршрут') : document.title.trim();
    final body = <Widget>[];
    final footer = <Widget>[];
    Widget navigation(String label, GeoPoint target, {required bool driving}) => OutlinedButton.icon(
          iconAlignment: IconAlignment.end,
          icon: const Icon(Icons.open_in_new),
          onPressed: () => unawaited(_navigate(target, driving: driving)),
          label: Text(context.t(label)),
        );
    Widget primary(String label, DrivingPlanAction action) => FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(TokenSizes.controlPrimaryMin)),
          iconAlignment: IconAlignment.end,
          icon: const Icon(Icons.arrow_forward),
          onPressed: () => controller.transition(action),
          label: Text(context.t(label)),
        );

    switch (state) {
      case DrivingOverview():
        body.addAll([
          Text(context.t('Около {minutes} мин · {visits} парковок', {'minutes': car.totalMinutes, 'visits': car.visits.length})),
          const SizedBox(height: TokenSizes.spaceXs),
          Text('${context.t('На машине · {minutes} мин', {'minutes': jsNumberToString(car.drivingMinutes)})} · ${context.t('Части прогулки')}: ${document.stops.length}',
              style: theme.textTheme.bodySmall),
          for (final (index, item) in car.visits.indexed)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(radius: 16, child: Text('P${index + 1}')),
              title: Text(item.parking.name),
              subtitle: Text(context.t('Рядом · {count} историй · около {minutes} мин', {'count': item.stopIds.length, 'minutes': jsNumberToString(item.visitMinutes)})),
            ),
        ]);
        footer.add(primary('Начать поездку', DrivingPlanAction.start));
      case DrivingToVisit(:final visitIndex) when visit != null:
        eyebrow = context.t('К парковке {current} из {total}', {'current': visitIndex + 1, 'total': car.visits.length});
        heading = visit.parking.name;
        final hours = visit.parking.openingHours;
        body.addAll([
          Text([context.t(parkingFeeLabel(visit.parking.fee)), ?hours].join(' · '), style: theme.textTheme.bodySmall),
          const SizedBox(height: TokenSizes.spaceXs),
          Text(context.t('Сначала откройте маршрут в навигаторе. Рассказы включаются только после парковки.')),
          const SizedBox(height: TokenSizes.spaceXs),
          navigation('Маршрут в навигаторе', visit.parking.entrance, driving: true),
          Semantics(liveRegion: true, child: Text(context.t('В дороге звук остановлен'), style: theme.textTheme.bodySmall)),
        ]);
        footer.add(primary('Я припарковался / Начать прогулку', DrivingPlanAction.parked));
      case DrivingVisiting(:final storyIndex) when visit != null:
        final total = visit.stopIds.length;
        eyebrow = context.t('Остановка {current} из {total} у этой парковки', {'current': storyIndex + 1, 'total': total});
        heading = chapter?.title ?? chapter?.step.place ?? context.t('История готовится');
        final source = controller.storySource;
        if (chapter == null) {
          body.add(Text(context.t('История этой остановки пока недоступна.')));
        } else {
          final contentLocale = widget.view.chapters
                  .where((item) => item.id == chapter.id)
                  .firstOrNull
                  ?.contentLocale ??
              ContentLocale.ru;
          if (chapter.title != chapter.step.place) body.add(Text(chapter.step.place, style: theme.textTheme.bodySmall));
          body.add(ContentLanguageNote(contentLocale: contentLocale, audioAvailable: source != null));
          if (chapter.content.story.paragraphs.isEmpty) {
            body.add(Text(context.t('Для этой части пока нет аудиозаписи. Текст доступен ниже.')));
          }
          body.add(StoryView(key: ValueKey(chapter.id), content: chapter.content, contentLocale: contentLocale));
        }
        final audio = controller.audio;
        if (audio.error case final error?) {
          body.add(Semantics(liveRegion: true, child: Text(context.t(error), style: const TextStyle(color: TokenColors.dangerInk))));
        }
        if (source != null) {
          footer.add(AudioControls(
            position: audio.position,
            duration: audio.duration > 0 ? audio.duration : chapter?.audio?.durationSec ?? 0,
            canSeek: audio.duration > 0 && controller.ownsService,
            playing: audio.playing || audio.loading,
            label: audio.playing ? context.t('Пауза') : context.t('Слушать историю'),
            rate: controller.rate,
            onRate: () => unawaited(controller.cycleRate()),
            onToggle: () => unawaited(_toggleAudio()),
            onSeek: controller.seekTo,
          ));
        }
        footer.add(storyIndex + 1 < total
            ? primary('Следующая история', DrivingPlanAction.nextStory)
            : primary('Вернуться к машине', DrivingPlanAction.returnToCar));
      case DrivingReturning(:final visitIndex) when visit != null:
        eyebrow = context.t('Вернуться к машине');
        heading = visit.parking.name;
        body.addAll([
          Text(context.t('Машина ждёт на парковке')),
          const SizedBox(height: TokenSizes.spaceXs),
          navigation('Маршрут к машине', visit.parking.pedestrianAccess, driving: false),
        ]);
        final hasNext = visitIndex + 1 < car.visits.length;
        footer.add(primary(
          hasNext
              ? 'Я у машины / Следующая парковка'
              : controller.options.finishRequired
                  ? 'Я у машины / К финишу'
                  : 'Я у машины',
          DrivingPlanAction.atCar,
        ));
      case DrivingFinishing():
        eyebrow = context.t('К финишу поездки');
        heading = document.destination?.address ?? document.start?.address ?? context.t('До финиша');
        final target = document.destination?.location ?? document.start?.location;
        if (target != null) body.add(navigation('Открыть навигатор', target, driving: true));
        footer.add(primary('Я на финише', DrivingPlanAction.finishReached));
      case DrivingComplete():
        heading = context.t('Поездка завершена');
        body.add(Text(context.t('Маршрут завершён. Спасибо за прогулку.')));
        footer.addAll([
          FilledButton(onPressed: () => context.go('/'), child: Text(context.t('На карту'))),
          TextButton(onPressed: () => controller.transition(DrivingPlanAction.restart), child: Text(context.t('Начать заново'))),
        ]);
      default:
        // A visit index the route no longer has: the reducer's restart is the way out.
        footer.add(primary('Начать заново', DrivingPlanAction.restart));
    }
    if (_linkFailed) {
      body.add(Semantics(liveRegion: true, child: Text(context.t('Не удалось открыть ссылку.'), style: theme.textTheme.bodySmall)));
    }

    final map = ref.watch(walkRouteMapProvider)(
      context,
      WalkMapProps(
        view: _framing.view(car: car, stops: document.stops, state: state, visit: visit, t: (source, values) => context.t(source, values)),
        onSelect: (_) {},
        label: context.t('Карта автомобильной прогулки: автомобильные переезды, пешие участки, парковки и истории'),
      ),
    );
    final intro = widget.intro;
    return LayoutBuilder(
      builder: (context, constraints) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(height: (constraints.maxHeight * 0.42).clamp(160.0, 420.0), child: map),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
            if (state is DrivingOverview && intro != null) ...[intro, const SizedBox(height: TokenSizes.spaceSm)],
            Text(eyebrow, style: theme.textTheme.bodySmall),
            Semantics(header: true, child: Text(heading, style: theme.textTheme.headlineSmall)),
            const SizedBox(height: TokenSizes.spaceSm),
            ...body,
          ]),
        ),
        Material(
          color: TokenColors.raised,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, TokenSizes.spaceSm),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: footer),
          ),
        ),
      ]),
    );
  }
}
