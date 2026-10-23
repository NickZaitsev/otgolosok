/// Bottom sheets and notices of the explore screen (site `around-sheets.tsx`, `walk-overview-sheet.tsx`).
library;

import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/cities.dart';
import '../../walk_engine/nearby_stories.dart';
import '../reviews/review_model.dart' show formatRatingSummary;
import 'cell_store.dart' show CellStatus;
import 'map_cells.dart';
import 'nearby_walks.dart';
import 'walk_overview.dart';

/// The island under the map controls: the sheets share its look and its height limit.
class ExplorePanel extends StatelessWidget {
  const ExplorePanel({super.key, required this.child, this.maxHeightFactor = 0.6});

  final Widget child;
  final double maxHeightFactor;

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height;
    return Material(
      color: TokenColors.surfaceIsland,
      elevation: 6,
      shadowColor: TokenColors.mapGreen.withValues(alpha: 0.3),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(TokenSizes.radiusIsland)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: height * maxHeightFactor, maxWidth: TokenSizes.contentReading),
        child: SafeArea(top: false, child: child),
      ),
    );
  }
}

/// Label, title and close button of a sheet.
class SheetHeader extends StatelessWidget {
  const SheetHeader({super.key, required this.title, required this.closeLabel, required this.onClose, this.label, this.titleLocale});

  final String? label;
  final String title;
  final Locale? titleLocale;
  final String closeLabel;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceSm, TokenSizes.spaceXs, TokenSizes.spaceXs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (label != null)
                Text(label!, style: theme.textTheme.labelMedium?.copyWith(color: TokenColors.mapOrange, fontWeight: FontWeight.w700)),
              Semantics(
                header: true,
                child: Text(title, locale: titleLocale, style: theme.textTheme.titleLarge?.copyWith(fontSize: TokenSizes.textSheetTitle)),
              ),
            ]),
          ),
          IconButton(tooltip: closeLabel, onPressed: onClose, icon: const Icon(Icons.close)),
        ],
      ),
    );
  }
}

/// A status line read out by screen readers when it changes.
class StatusText extends StatelessWidget {
  const StatusText(this.text, {super.key, this.error = false});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        child: Text(text, style: error ? TextStyle(color: Theme.of(context).colorScheme.error) : null),
      );
}

Locale? _russianContent(BuildContext context) => context.appLocale == AppLocale.ru ? null : AppLocale.ru.flutterLocale;

/// Asks for geolocation once; closing it is remembered by the screen.
class LocationPromptSheet extends StatelessWidget {
  const LocationPromptSheet({super.key, required this.locating, required this.failed, required this.onLocate, required this.onDismiss});

  final bool locating;
  final bool failed;
  final VoidCallback onLocate;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) => ExplorePanel(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SheetHeader(title: context.t('Смотрите истории рядом с вами'), closeLabel: context.t('Закрыть карточку'), onClose: onDismiss),
          Padding(
            padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceMd),
            child: FilledButton.icon(
              onPressed: locating ? null : onLocate,
              icon: const Icon(Icons.my_location),
              label: Text(context.t(locating ? 'Определяем положение…' : failed ? 'Проверить снова' : 'Включить геолокацию')),
            ),
          ),
        ]),
      );
}

sealed class NearbyWalksState {
  const NearbyWalksState();
}

class NearbyWalksLoading extends NearbyWalksState {
  const NearbyWalksLoading();
}

class NearbyWalksFailed extends NearbyWalksState {
  const NearbyWalksFailed();
}

class NearbyWalksReady extends NearbyWalksState {
  const NearbyWalksReady(this.walks);

  final List<NearbyWalk> walks;
}

/// Ready stories around a point with the radius to search in, and the walks passing nearby.
class NearbySheet extends StatelessWidget {
  const NearbySheet({
    super.key,
    required this.status,
    required this.radius,
    required this.recommendations,
    required this.walks,
    required this.onRadius,
    required this.onSelect,
    required this.onOpenWalk,
    required this.onRetryWalks,
    required this.onClose,
  });

  /// Whether the catalog cells around the point are loaded.
  final CellStatus status;
  final int radius;
  final List<NearbyRecommendation> recommendations;
  final NearbyWalksState walks;
  final ValueChanged<int> onRadius;
  final ValueChanged<String> onSelect;
  final ValueChanged<NearbyWalk> onOpenWalk;
  final VoidCallback onRetryWalks;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final index = nearbyRadii.indexOf(radius);
    final wider = index >= 0 && index + 1 < nearbyRadii.length ? nearbyRadii[index + 1] : null;
    final content = _russianContent(context);
    return ExplorePanel(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(
          label: context.t('Готовые истории рядом'),
          title: context.t('В радиусе {radius} м', {'radius': radius}),
          closeLabel: context.t('Закрыть истории рядом'),
          onClose: onClose,
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceMd),
            children: [
              Semantics(
                container: true,
                label: context.t('Радиус поиска'),
                child: SegmentedButton<int>(
                  showSelectedIcon: false,
                  segments: [
                    for (final value in nearbyRadii) ButtonSegment(value: value, label: Text(context.t('{distance} м', {'distance': value}))),
                  ],
                  selected: {radius},
                  onSelectionChanged: (selection) => onRadius(selection.single),
                ),
              ),
              const SizedBox(height: TokenSizes.spaceSm),
              if (status != CellStatus.ready)
                StatusText(context.t(status == CellStatus.loading
                    ? 'Ищем истории рядом…'
                    : 'Не удалось загрузить все истории рядом. Повторите загрузку мест.')),
              for (final (position, item) in recommendations.indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(item.story.title, locale: content, style: theme.textTheme.titleMedium),
                    Text.rich(TextSpan(style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant), children: [
                      TextSpan(text: item.story.address, locale: content),
                      TextSpan(text: ' · ${context.t('{distance} м по прямой', {'distance': item.distanceM.round()})}'),
                    ])),
                    if (position == 0) Text(item.reason, style: theme.textTheme.bodySmall),
                    const SizedBox(height: TokenSizes.spaceXs),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: position == 0
                          ? FilledButton.icon(
                              onPressed: () => onSelect(item.story.id),
                              icon: const Icon(Icons.headphones),
                              label: Text(context.t('Слушать')),
                            )
                          : OutlinedButton.icon(
                              onPressed: () => onSelect(item.story.id),
                              icon: const Icon(Icons.arrow_forward),
                              label: Text(context.t('Альтернатива')),
                            ),
                    ),
                  ]),
                ),
              if (recommendations.isEmpty && status == CellStatus.ready) ...[
                Text(context.t('В этом радиусе пока нет готовой проверенной истории.')),
                const SizedBox(height: TokenSizes.spaceXs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: wider != null
                      ? OutlinedButton(onPressed: () => onRadius(wider), child: Text(context.t('Искать в большем радиусе')))
                      : OutlinedButton(onPressed: onClose, child: Text(context.t('Выбрать другую точку'))),
                ),
              ],
              _NearbyWalksSection(state: walks, onOpen: onOpenWalk, onRetry: onRetryWalks),
            ],
          ),
        ),
      ]),
    );
  }
}

class _NearbyWalksSection extends StatelessWidget {
  const _NearbyWalksSection({required this.state, required this.onOpen, required this.onRetry});

  final NearbyWalksState state;
  final ValueChanged<NearbyWalk> onOpen;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = this.state;
    final header = Padding(
      padding: const EdgeInsets.only(top: TokenSizes.spaceMd, bottom: TokenSizes.spaceXs),
      child: Semantics(header: true, child: Text(context.t('Прогулки рядом'), style: theme.textTheme.titleMedium)),
    );
    return switch (state) {
      // Walks are an addition to the stories: while they load nothing pushes the list around.
      NearbyWalksLoading() => const SizedBox.shrink(),
      NearbyWalksReady(walks: final walks) when walks.isEmpty => const SizedBox.shrink(),
      NearbyWalksFailed() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          header,
          StatusText(context.t('Не удалось загрузить прогулки')),
          TextButton(onPressed: onRetry, child: Text(context.t('Повторить'))),
        ]),
      NearbyWalksReady(walks: final walks) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          header,
          for (final walk in walks)
            Card(
              margin: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
              color: TokenColors.raised,
              child: InkWell(
                onTap: () => onOpen(walk),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
                  child: Padding(
                    padding: const EdgeInsets.all(TokenSizes.spaceSm),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(walk.title, locale: _russianContent(context), style: theme.textTheme.titleSmall)),
                        if (walk.isOwn)
                          Padding(
                            padding: const EdgeInsets.only(left: TokenSizes.spaceXs),
                            child: Text(context.t('Ваша'), style: theme.textTheme.labelMedium?.copyWith(color: TokenColors.mapGreen)),
                          ),
                      ]),
                      Text(
                        formatNearbyWalkMeta(walk, context.appLocale, context.t),
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ]),
                  ),
                ),
              ),
            ),
        ]),
    };
  }
}

/// The walks under a tap on their overview lines: one walk shows its card, several are listed nearest first.
class WalkOverviewSheet extends StatelessWidget {
  const WalkOverviewSheet({super.key, required this.walks, required this.selected, required this.onSelect, required this.onOpen, required this.onClose});

  final List<MapWalk> walks;
  final String? selected;
  final ValueChanged<String> onSelect;
  final ValueChanged<MapWalk> onOpen;
  final VoidCallback onClose;

  static const _colors = [
    TokenColors.walkOverview1, TokenColors.walkOverview2, TokenColors.walkOverview3, //
    TokenColors.walkOverview4, TokenColors.walkOverview5, TokenColors.walkOverview6,
  ];

  static Color colorOf(MapWalk walk) => _colors[walkColorIndex(walk.key) - 1];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final single = walks.length == 1 ? walks.single : null;
    final content = _russianContent(context);
    String details(MapWalk walk) {
      final rating = formatRatingSummary(walk.rating, context.appLocale);
      return '${formatMapWalkMeta(walk, context.appLocale, context.t)} · ${rating.isEmpty ? context.t('Пока без оценок') : rating}';
    }

    Widget swatch(MapWalk walk) => Container(
          width: 6,
          height: 40,
          margin: const EdgeInsets.only(right: TokenSizes.spaceSm),
          decoration: BoxDecoration(color: colorOf(walk), borderRadius: BorderRadius.circular(3)),
        );

    Widget open(MapWalk walk) => FilledButton.icon(
          onPressed: () => onOpen(walk),
          icon: const Icon(Icons.arrow_forward),
          label: Text(context.t('Открыть прогулку')),
        );

    return ExplorePanel(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(
          label: single != null ? context.t('Прогулка') : context.t('Прогулок здесь: {count}', {'count': walks.length}),
          title: single?.title ?? context.t('Выберите прогулку'),
          titleLocale: single == null ? null : content,
          closeLabel: context.t('Закрыть карточку'),
          onClose: onClose,
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceMd),
            children: single != null
                ? [
                    Row(children: [swatch(single), Expanded(child: Text(details(single)))]),
                    const SizedBox(height: TokenSizes.spaceSm),
                    open(single),
                  ]
                : [
                    for (final walk in walks)
                      Padding(
                        padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Semantics(
                            selected: walk.key == selected,
                            button: true,
                            child: InkWell(
                              onTap: () => onSelect(walk.key),
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
                                child: Row(children: [
                                  swatch(walk),
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text(walk.title, locale: content, style: theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: walk.key == selected ? FontWeight.w700 : null,
                                      )),
                                      Text(details(walk), style: theme.textTheme.bodySmall),
                                    ]),
                                  ),
                                ]),
                              ),
                            ),
                          ),
                          if (walk.key == selected) Padding(padding: const EdgeInsets.only(top: TokenSizes.spaceXs), child: open(walk)),
                        ]),
                      ),
                  ],
          ),
        ),
      ]),
    );
  }
}

/// The places of a group that stays together at the deepest zoom (the site spreads them around a spider).
class ClusterListSheet extends StatelessWidget {
  const ClusterListSheet({super.key, required this.points, required this.onSelect, required this.onClose});

  final List<CatalogPoint> points;
  final ValueChanged<CatalogPoint> onSelect;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final content = _russianContent(context);
    return ExplorePanel(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(
          label: context.t('Мест: {count}', {'count': points.length}),
          title: context.t('Выберите историю'),
          closeLabel: context.t('Закрыть карточку'),
          onClose: onClose,
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
            children: [
              for (final point in points)
                ListTile(
                  minTileHeight: TokenSizes.controlPrimaryMin,
                  title: Text(point.title, locale: content),
                  subtitle: point.address == point.title ? null : Text(point.address, locale: content),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => onSelect(point),
                ),
            ],
          ),
        ),
      ]),
    );
  }
}

/// A message over the map with an optional retry and a close button.
class ExploreNotice extends StatelessWidget {
  const ExploreNotice({super.key, required this.message, this.onClose, this.onRetry, this.retryLabel, this.alert = false, this.children = const []});

  final String message;
  final VoidCallback? onClose;
  final VoidCallback? onRetry;
  final String? retryLabel;
  final bool alert;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Material(
        color: alert ? TokenColors.alertSurface : TokenColors.surfaceIslandGlass,
        elevation: 3,
        borderRadius: BorderRadius.circular(TokenSizes.radiusMd),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(TokenSizes.spaceSm, TokenSizes.spaceXs, 0, TokenSizes.spaceXs),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceSm),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  StatusText(message),
                  ...children,
                  if (onRetry != null) TextButton(onPressed: onRetry, child: Text(retryLabel ?? context.t('Повторить'))),
                ]),
              ),
            ),
            if (onClose != null) IconButton(tooltip: context.t('Скрыть сообщение'), onPressed: onClose, icon: const Icon(Icons.close)),
          ]),
        ),
      );
}

/// Cities to jump to when the user is outside the catalog (site `GeoNotice`).
class CityChoices extends StatelessWidget {
  const CityChoices({super.key, required this.onCity});

  final ValueChanged<City> onCity;

  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        label: context.t('Город'),
        child: Wrap(spacing: TokenSizes.spaceXs, children: [
          for (final city in cities) OutlinedButton(onPressed: () => onCity(city), child: Text(context.t(city.name))),
        ]),
      );
}

/// How to allow the location permission on Android, with a way to the app settings.
class GeoHelp extends StatelessWidget {
  const GeoHelp({super.key, required this.onRetry, required this.onOpenSettings});

  final VoidCallback onRetry;
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) => ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        title: Text(context.t('Как разрешить геолокацию')),
        children: [
          for (final (index, step) in const [
            'Откройте «Настройки» телефона → «Приложения» → «Отголосок» → «Разрешения» → «Местоположение».',
            'Выберите «Разрешить только во время использования приложения» и включите «Точное местоположение».',
            'Проверьте, что геолокация включена в быстрых настройках телефона, и вернитесь в приложение.',
          ].indexed)
            Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('${index + 1}. ${context.t(step)}')),
          Wrap(spacing: TokenSizes.spaceXs, children: [
            OutlinedButton(onPressed: onOpenSettings, child: Text(context.t('Открыть настройки'))),
            TextButton(onPressed: onRetry, child: Text(context.t('Проверить снова'))),
          ]),
        ],
      );
}
