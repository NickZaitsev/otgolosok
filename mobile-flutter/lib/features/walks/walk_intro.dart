import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/router.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/user_message.dart';
import '../../walk_engine/js_json.dart';
import '../../walk_engine/walk_view.dart';
import '../feedback/improvement_sheet.dart';
import '../offline/offline_copy.dart';
import '../player/walk_player_panel.dart' show AddFood;
import '../reviews/review_model.dart';
import '../reviews/review_sheet.dart';
import '../reviews/walk_reviews_controller.dart';
import '../reviews/walk_reviews_section.dart';
import '../walk_builder/builder_api.dart';
import '../walk_builder/builder_storage.dart' show newUuid;
import 'car_copy.dart';
import 'format.dart';
import 'local_walks.dart';
import 'own_walk.dart';
import 'walk_link.dart';
import 'walk_loader.dart';
import 'walk_player_slot.dart';

/// The title the walk is shown under; a builder walk may still have none.
String walkTitle(BuildContext context, WalkView view) {
  final title = view.document.title.trim();
  return title.isEmpty ? context.t('Ваш маршрут') : title;
}

/// What a stop is called: its story title, or its address while there is no story.
String stopTitle(WalkView view, int index) => view.chapters[index].story?.title ?? view.document.stops[index].place.address;

/// The opened walk: notices, its summary and tools before the start, and the player.
class WalkReadyView extends ConsumerWidget {
  const WalkReadyView({
    super.key,
    required this.link,
    required this.walk,
    required this.localAudio,
    required this.reviews,
    required this.offline,
    this.mount,
    this.onAddFood,
  });

  final WalkLink link;
  final LoadedWalk walk;
  final Map<String, Uri> localAudio;
  final WalkReviewsController? reviews;
  final OfflineCopyController? offline;

  /// The load the walk came from; the player keeps running while it stays the same.
  final String? mount;

  /// Adds a food place to the walk; null where places cannot join it.
  final AddFood? onAddFood;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(walkActiveProvider);
    final view = walk.view;
    final title = walkTitle(context, view);
    final edit = ownWalkEditLocation(link);
    final notices = [
      if (walk.savedAt case final savedAt?) offlineNotice(context, savedAt),
      if (link.fromStop case final fromStop?) startNotice(context, view, fromStop),
    ];
    // Two title lines with the user's font size: the standard bar cuts them at large text.
    final titleStyle = Theme.of(context).textTheme.titleLarge!;
    final titleLines = MediaQuery.textScalerOf(context).scale(titleStyle.fontSize!) * (titleStyle.height ?? 1.2) * 2;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: math.max(kToolbarHeight, titleLines + 8),
        title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
        actions: [
          _WalkMenu(
            title: title,
            reviews: reviews,
            target: reviews?.target,
            offline: offline,
            viewJson: walk.data.json,
            edit: active ? null : edit,
          ),
        ],
      ),
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (notices.isNotEmpty)
            Container(
              color: TokenColors.alertSurface,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Semantics(liveRegion: true, child: Text(notices.join(' '), style: const TextStyle(color: TokenColors.alertInk))),
            ),
          Expanded(
            child: WalkPlayerSlot(
              view: view,
              link: link,
              localAudio: localAudio,
              mount: mount,
              onAddFood: onAddFood,
              intro: active ? null : WalkIntro(link: link, walk: walk, reviews: reviews, offline: offline),
            ),
          ),
        ]),
      ),
    );
  }
}

/// «Офлайн-копия от {date}. Последняя редакция может быть новее.»
String offlineNotice(BuildContext context, String savedAt) {
  final saved = DateTime.tryParse(savedAt);
  final date = saved == null ? savedAt : MaterialLocalizations.of(context).formatShortDate(saved.toLocal());
  return context.t('Офлайн-копия от {date}. Последняя редакция может быть новее.', {'date': date});
}

/// «Начало с остановки «{title}».»
String startNotice(BuildContext context, WalkView view, String fromStop) {
  final index = view.document.stops.indexWhere((stop) => stop.id == fromStop);
  return context.t('Начало с остановки «{title}».', {'title': index < 0 ? '' : stopTitle(view, index)});
}

/// Summary and tools of a walk that has not started (site `WalkSession` before the start).
class WalkIntro extends ConsumerStatefulWidget {
  const WalkIntro({super.key, required this.link, required this.walk, required this.reviews, required this.offline});
  final WalkLink link;
  final LoadedWalk walk;
  final WalkReviewsController? reviews;
  final OfflineCopyController? offline;

  @override
  ConsumerState<WalkIntro> createState() => _WalkIntroState();
}

class _WalkIntroState extends ConsumerState<WalkIntro> {
  bool _carBusy = false;
  String _carError = '';

  WalkView get _view => widget.walk.view;

  Future<void> _goByCar() async {
    if (_carBusy) return;
    setState(() {
      _carBusy = true;
      _carError = '';
    });
    try {
      final id = await createCarCopy(
        widget.walk.data,
        plan: ref.read(builderApiProvider).plan,
        store: ref.read(localWalkStoreProvider),
        newId: newUuid,
      );
      if (!mounted) return;
      setState(() => _carBusy = false);
      unawaited(context.push(LocalWalkLink(id).location));
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() {
        _carBusy = false;
        _carError = switch (error) {
          CarCopyError(:final message) => context.t(message),
          _ => userMessage(context, error, 'Не удалось построить автомобильную прогулку.'),
        };
      });
    }
  }

  String _meta(BuildContext context) {
    final document = _view.document;
    final route = document.route;
    final minutes = route?.car?.totalMinutes ?? route?.walkingMinutes ?? document.minutes;
    final distance = (route?.distanceM ?? 0) / 1000;
    return context.t('{minutes} мин · {distance} км', {'minutes': jsNumberToString(minutes), 'distance': formatUpToOne(distance, context.appLocale)});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final view = _view;
    final document = view.document;
    final reviews = widget.reviews;
    final own = widget.link is LocalWalkLink || widget.link is AccountWalkLink;
    final canReverse = !document.driving && document.route != null && widget.link.fromStop == null;
    final reversed = canReverse && ref.watch(walkReversedProvider(document.id));
    final car = !document.driving && canCopyByCar(widget.walk.data);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (reviews == null)
        Text(_meta(context), style: theme.textTheme.bodySmall)
      else
        ListenableBuilder(
          listenable: reviews,
          builder: (context, _) {
            final rating = formatRatingSummary(reviews.summary, context.appLocale);
            return Text([_meta(context), if (rating.isNotEmpty) rating].join(' · '), style: theme.textTheme.bodySmall);
          },
        ),
      if (document.description.trim().isNotEmpty) ...[
        const SizedBox(height: 4),
        Text(document.description.trim(), style: theme.textTheme.bodyMedium),
      ],
      if (own)
        for (final note in ownWalkNotes(context, view))
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(note, style: theme.textTheme.bodySmall)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 4, children: [
        if (document.stops.isNotEmpty)
          OutlinedButton.icon(
            icon: const Icon(Icons.format_list_numbered),
            onPressed: () => showStopsSheet(context, link: widget.link, view: view, offline: widget.offline, viewJson: widget.walk.data.json),
            label: Text(context.t('Остановки · {count}', {'count': document.stops.length})),
          ),
        if (canReverse)
          Semantics(
            label: context.t('Пройти прогулку с конца'),
            toggled: reversed,
            button: true,
            excludeSemantics: true,
            child: OutlinedButton.icon(
              icon: const Icon(Icons.swap_vert),
              onPressed: () => ref
                  .read(walkReversedProvider(document.id).notifier)
                  .set(!reversed)
                  .catchError((Object error) => debugPrint('walk direction not saved: ${error.runtimeType}')),
              label: Text(reversed ? context.t('Направление: с конца') : context.t('Направление: с начала')),
            ),
          ),
        if (reviews != null)
          ListenableBuilder(
            listenable: reviews,
            builder: (context, _) => (reviews.summary?.count ?? 0) == 0
                ? OutlinedButton(
                    onPressed: () => showReviewSheet(context, reviews: reviews, walkTitle: walkTitle(context, view)),
                    child: Text(reviews.mine == null ? context.t('Оставить отзыв') : context.t('Изменить отзыв')),
                  )
                : OutlinedButton(
                    onPressed: () => showReviewsSheet(context, reviews: reviews, walkTitle: walkTitle(context, view)),
                    child: Text(context.t('Отзывы')),
                  ),
          ),
      ]),
      if (car) ...[
        const SizedBox(height: 8),
        OutlinedButton.icon(
          icon: const Icon(Icons.directions_car_outlined),
          onPressed: _carBusy ? null : _goByCar,
          label: Text(_carBusy ? context.t('Подбираем парковки и переезды…') : context.t('Пройти на машине')),
        ),
        Text(
          context.t('Создадим копию на устройстве с теми же историями, парковками и пешими участками. Максимум три часа, без учёта пробок.'),
          style: theme.textTheme.bodySmall,
        ),
        if (_carError.isNotEmpty)
          Semantics(liveRegion: true, child: Text(_carError, style: const TextStyle(color: TokenColors.dangerInk))),
      ],
    ]);
  }
}

/// Reviews of the walk in a sheet; the author's own form opens over it.
Future<void> showReviewsSheet(BuildContext context, {required WalkReviewsController reviews, required String walkTitle}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (context, controller) => ListView(controller: controller, padding: const EdgeInsets.all(16), children: [
          Semantics(header: true, child: Text(context.t('Отзывы'), style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: 8),
          WalkReviewsSection(reviews: reviews, onRate: () => showReviewSheet(context, reviews: reviews, walkTitle: walkTitle)),
        ]),
      ),
    );

/// The stops with the start and finish addresses; a walking walk can start from any of them.
Future<void> showStopsSheet(BuildContext context,
        {required WalkLink link, required WalkView view, required OfflineCopyController? offline, required Object? viewJson}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (context, controller) => StopsList(link: link, view: view, offline: offline, viewJson: viewJson, scroll: controller),
      ),
    );

class StopsList extends StatelessWidget {
  const StopsList({super.key, required this.link, required this.view, required this.offline, required this.viewJson, this.scroll});
  final WalkLink link;
  final WalkView view;
  final OfflineCopyController? offline;
  final Object? viewJson;
  final ScrollController? scroll;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final document = view.document;
    final start = document.start?.address;
    final finish = document.destination?.address ?? start;
    final canChoose = !document.driving;
    return ListView(controller: scroll, padding: const EdgeInsets.all(16), children: [
      Semantics(header: true, child: Text(context.t('Остановки · {count}', {'count': document.stops.length}), style: theme.textTheme.titleLarge)),
      if (start != null)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            start == finish ? context.t('Старт и финиш: {address}', {'address': start}) : context.t('Старт: {address}', {'address': start}),
            style: theme.textTheme.bodySmall,
          ),
        ),
      for (var index = 0; index < document.stops.length; index++)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(radius: 16, child: Text('${index + 1}')),
          title: Text(stopTitle(view, index)),
          selected: document.stops[index].id == link.fromStop,
          trailing: canChoose && document.stops[index].id != link.fromStop
              ? IconButton(
                  tooltip: context.t('Начать с этой остановки'),
                  icon: const Icon(Icons.play_circle_outline),
                  onPressed: () => _startFrom(context, document.stops[index].id),
                )
              : null,
        ),
      if (finish != null && finish != start)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(context.t('Финиш: {address}', {'address': finish}), style: theme.textTheme.bodySmall),
        ),
      if (link.fromStop != null)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(onPressed: () => _startFrom(context, null), child: Text(context.t('Начать с первой остановки'))),
        ),
      if (offline != null) ...[
        const Divider(height: 32),
        OfflineCopyControls(copy: offline!, viewJson: viewJson),
      ],
    ]);
  }

  void _startFrom(BuildContext context, String? stopId) {
    Navigator.of(context).pop();
    final next = switch (link) {
      CatalogWalkLink(:final slug) => CatalogWalkLink(slug, fromStop: stopId),
      SharedWalkLink(:final token) => SharedWalkLink(token, fromStop: stopId),
      AccountWalkLink(:final id) => AccountWalkLink(id, fromStop: stopId),
      LocalWalkLink(:final id) => LocalWalkLink(id, fromStop: stopId),
    };
    context.replace(next.location);
  }
}

enum _MenuAction { rate, improve, offline, edit }

/// Rating, improvement requests, the offline copy and editing stay reachable during the walk too.
class _WalkMenu extends StatelessWidget {
  const _WalkMenu({
    required this.title,
    required this.reviews,
    required this.target,
    required this.offline,
    required this.viewJson,
    required this.edit,
  });

  final String title;
  final WalkReviewsController? reviews;
  final ReviewTarget? target;
  final OfflineCopyController? offline;
  final Object? viewJson;
  final String? edit;

  @override
  Widget build(BuildContext context) {
    final items = [
      if (reviews != null) PopupMenuItem(value: _MenuAction.rate, child: Text(context.t('Оценить прогулку'))),
      if (target != null) PopupMenuItem(value: _MenuAction.improve, child: Text(context.t('Что улучшить в прогулке?'))),
      if (offline != null) PopupMenuItem(value: _MenuAction.offline, child: Text(context.t('Офлайн-копия'))),
      if (edit != null) PopupMenuItem(value: _MenuAction.edit, child: Text(context.t('Изменить маршрут'))),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return PopupMenuButton<_MenuAction>(
      tooltip: context.t('Настройки прогулки'),
      itemBuilder: (_) => items,
      onSelected: (action) => switch (action) {
        _MenuAction.rate => showReviewSheet(context, reviews: reviews!, walkTitle: title),
        _MenuAction.improve => showImprovementSheet(context, target: target!, walkTitle: title),
        _MenuAction.offline => _showOffline(context),
        _MenuAction.edit => context.push(edit!),
      },
    );
  }

  Future<void> _showOffline(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        useSafeArea: true,
        builder: (context) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text(context.t('Офлайн-копия'), style: Theme.of(context).textTheme.titleLarge)),
            const SizedBox(height: 8),
            OfflineCopyControls(copy: offline!, viewJson: viewJson),
          ]),
        ),
      );
}
