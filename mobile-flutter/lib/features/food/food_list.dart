// «Поесть рядом» on the walk screen (site `FoodList` in `food-list.tsx`): the places along the route, grouped by
// stop before the start and split into ahead and behind during the walk, with the card of the chosen one.
import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import 'food_card.dart';
import 'food_model.dart';
import 'food_walk_model.dart';
import 'opening_hours.dart';
import 'route_proximity.dart';

/// Adding places to the walk: which ones are in it, which one is being added and the outcome to announce.
class FoodAdding {
  const FoodAdding({required this.isAdded, required this.onAdd, required this.pending, required this.status});

  final bool Function(FoodPlace place) isAdded;
  final void Function(RouteFoodPlace place) onAdd;

  /// The id of the place being added; every add button waits meanwhile.
  final String? pending;
  final String status;
}

class WalkFoodList extends StatelessWidget {
  const WalkFoodList({
    super.key,
    required this.places,
    required this.stops,
    required this.active,
    required this.fromM,
    required this.selected,
    required this.onSelect,
    required this.onBack,
    required this.onClose,
    required this.manifest,
    required this.hours,
    required this.error,
    required this.loading,
    required this.onRetry,
    this.adding,
  });

  final List<RouteFoodPlace> places;

  /// The stops' distances along the route.
  final List<double> stops;
  final bool active;

  /// Where the current leg starts along the route.
  final double fromM;
  final RouteFoodPlace? selected;
  final ValueChanged<RouteFoodPlace> onSelect;
  final VoidCallback onBack;
  final VoidCallback onClose;
  final FoodManifest manifest;
  final FoodHoursCache hours;
  final bool error;
  final bool loading;
  final VoidCallback onRetry;

  /// Null where places cannot join the walk.
  final FoodAdding? adding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final adding = this.adding;
    final status = adding == null || adding.status.isEmpty
        ? null
        : Semantics(liveRegion: true, child: Text(adding.status, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)));
    final selected = this.selected;
    final header = Row(children: [
      Expanded(
        child: Semantics(header: true, child: Text(context.t('Поесть рядом'), style: theme.textTheme.titleLarge)),
      ),
      IconButton(tooltip: context.t('Закрыть'), onPressed: onClose, icon: const Icon(Icons.close)),
    ]);
    if (selected != null) {
      // During the walk only the places ahead can join it: the way to those behind is already walked.
      final canAdd = adding != null && (!active || selected.alongM >= fromM);
      return ListView(padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, TokenSizes.spaceMd), children: [
        header,
        FoodCard(
          place: selected.place,
          manifest: manifest,
          hours: hours,
          onBack: onBack,
          distanceLabel: formatRouteDistance(selected.distanceM).resolve(context.t),
          action: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ?status,
            if (canAdd) Padding(padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceXs), child: _AddButton(place: selected, adding: adding, wide: true)),
          ]),
        ),
      ]);
    }
    return FoodMinute(builder: (context, now) {
      final split = splitRouteFood(places, fromM);
      List<Widget> rows(List<RouteFoodPlace> items, {bool addable = true}) => [
            for (final place in items) _Row(place: place, now: now, hours: hours, onSelect: onSelect, adding: addable ? adding : null),
          ];
      return ListView(padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, TokenSizes.spaceMd), children: [
        header,
        ?status,
        if (error)
          Semantics(
            liveRegion: true,
            child: Row(children: [
              Expanded(child: Text(context.t('Не удалось загрузить заведения'))),
              TextButton(onPressed: onRetry, child: Text(context.t('Повторить'))),
            ]),
          )
        else if (loading)
          Semantics(liveRegion: true, child: Text(context.t('Загружаем заведения…')))
        else if (places.isEmpty)
          Text(context.t('В 150 м от маршрута заведений нет по данным OpenStreetMap')),
        if (active) ...[
          if (split.ahead.isNotEmpty) ...[_Subheading(context.t('Впереди')), ...rows(split.ahead)],
          if (split.behind.isNotEmpty)
            Theme(
              data: theme.copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: EdgeInsets.zero,
                title: Text(context.t('Позади · {count}', {'count': split.behind.length}), style: theme.textTheme.titleSmall),
                children: rows(split.behind, addable: false),
              ),
            ),
        ] else
          for (final group in groupRouteFood(places, stops)) ...[
            if (group.stop case final stop?) _Subheading(context.t('У остановки {number}', {'number': stop + 1})),
            ...rows(group.places),
          ],
        FoodAttribution(manifest: manifest),
      ]);
    });
  }
}

class _Subheading extends StatelessWidget {
  const _Subheading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: TokenSizes.spaceSm),
        child: Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleSmall)),
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.place, required this.now, required this.hours, required this.onSelect, required this.adding});

  final RouteFoodPlace place;
  final DateTime now;
  final FoodHoursCache hours;
  final ValueChanged<RouteFoodPlace> onSelect;
  final FoodAdding? adding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final adding = this.adding;
    return Row(children: [
      Expanded(
        child: InkWell(
          onTap: () => onSelect(place),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceXs),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 2, right: TokenSizes.spaceXs), child: FoodGlyph(kind: place.place.kind)),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(place.place.name, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                  Text(formatHoursStatus(hours.status(place.place.openingHours, now)).resolve(context.t), style: theme.textTheme.bodySmall),
                  Text(formatRouteDistance(place.distanceM).resolve(context.t), style: theme.textTheme.bodySmall?.copyWith(color: TokenColors.muted)),
                ]),
              ),
            ]),
          ),
        ),
      ),
      if (adding != null) _AddButton(place: place, adding: adding),
    ]);
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.place, required this.adding, this.wide = false});

  final RouteFoodPlace place;
  final FoodAdding adding;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    if (adding.isAdded(place.place)) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: TokenSizes.spaceXs),
        child: Text(context.t('В прогулке'), textAlign: wide ? TextAlign.center : null, style: const TextStyle(color: TokenColors.teal, fontWeight: FontWeight.w600)),
      );
    }
    final busy = adding.pending == place.id;
    final onPressed = adding.pending == null ? () => adding.onAdd(place) : null;
    if (wide) {
      return FilledButton.icon(
        onPressed: onPressed,
        icon: busy ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add),
        label: Text(context.t(busy ? 'Прокладываем путь…' : 'Добавить в прогулку')),
      );
    }
    return IconButton(
      tooltip: context.t('Добавить «{name}» в прогулку', {'name': place.place.name}),
      onPressed: onPressed,
      icon: busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_circle_outline),
    );
  }
}
