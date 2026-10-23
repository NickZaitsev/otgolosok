// The food card and its parts (site `food-list.tsx`: `FoodGlyph`, `FoodAttribution`, `FoodCard`).
import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../legal/legal_links.dart' show openUrl;
import 'food_kinds.dart';
import 'food_model.dart';
import 'food_walk_model.dart';
import 'opening_hours.dart';

/// The coloured disc of the place's group, as on the map.
class FoodGlyph extends StatelessWidget {
  const FoodGlyph({super.key, required this.kind, this.size = 24});

  final FoodKind kind;
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(child: Image.asset(foodGroup(kind).asset, width: size, height: size));
}

/// «Данные OpenStreetMap на 1 октября 2026 г.» and the licence line.
class FoodAttribution extends StatelessWidget {
  const FoodAttribution({super.key, required this.manifest});

  final FoodManifest manifest;

  @override
  Widget build(BuildContext context) {
    // The date of the data in Moscow, which has no daylight saving time (UTC+3).
    final moscow = manifest.editedAt.toUtc().add(const Duration(hours: 3));
    final date = MaterialLocalizations.of(context).formatFullDate(moscow).replaceFirst(RegExp(r'^[^,]+,\s*'), '');
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(color: TokenColors.muted);
    return Padding(
      padding: const EdgeInsets.only(top: TokenSizes.spaceSm),
      child: Text('${context.t('Данные OpenStreetMap на {date}. Часы работы могут отличаться.', {'date': date})}\n${manifest.attribution}', style: style),
    );
  }
}

/// Rebuilds once a minute, so «Открыто до 22:00» turns into «Закрыто» on time.
class FoodMinute extends StatefulWidget {
  const FoodMinute({super.key, required this.builder, this.now = DateTime.now});

  final Widget Function(BuildContext context, DateTime now) builder;
  final DateTime Function() now;

  @override
  State<FoodMinute> createState() => _FoodMinuteState();
}

class _FoodMinuteState extends State<FoodMinute> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  void _schedule() {
    final now = widget.now();
    _timer = Timer(Duration(seconds: 60 - now.second), () {
      if (!mounted) return;
      setState(() {});
      _schedule();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, widget.now());
}

/// The details of one place: category, distance, hours, address, links and the data note.
class FoodCard extends StatelessWidget {
  const FoodCard({
    super.key,
    required this.place,
    required this.manifest,
    required this.hours,
    this.heading = true,
    this.distanceLabel,
    this.action,
    this.onBack,
  });

  final FoodPlace place;
  final FoodManifest manifest;
  final FoodHoursCache hours;
  final bool heading;
  final String? distanceLabel;

  /// What the walker can do with the place, under its details.
  final Widget? action;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final website = foodWebsite(place.website), phone = foodPhone(place.phone);
    return Semantics(
      container: true,
      label: context.t('Заведение'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        if (onBack != null) TextButton.icon(onPressed: onBack, icon: const Icon(Icons.arrow_back), label: Text(context.t('Назад к списку'))),
        if (heading) Semantics(header: true, child: Text(place.name, style: theme.textTheme.titleLarge)),
        Text([for (final source in foodCategorySources(place.kind, place.cuisine)) context.t(source)].join(' · ')),
        if (distanceLabel != null) Text(distanceLabel!),
        FoodMinute(builder: (context, now) {
          final status = hours.status(place.openingHours, now);
          final holiday = formatHolidayCaveat(status);
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(formatHoursStatus(status).resolve(context.t), style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            if (holiday != null) Text(holiday.resolve(context.t), style: theme.textTheme.bodySmall),
          ]);
        }),
        if (place.openingHours case final raw?)
          Theme(
            data: theme.copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
              expandedAlignment: Alignment.centerLeft,
              title: Text(context.t('Часы работы по данным OpenStreetMap'), style: theme.textTheme.bodyMedium),
              children: [SelectableText(raw)],
            ),
          ),
        if (place.address case final address?) Text(address),
        ?action,
        if (website != null || phone != null)
          Wrap(spacing: TokenSizes.spaceXs, children: [
            if (website != null) TextButton(onPressed: () => unawaited(openUrl(context, website)), child: Text(context.t('Сайт'))),
            if (phone != null) TextButton(onPressed: () => unawaited(openUrl(context, phone, external: true)), child: Text(context.t('Позвонить'))),
          ]),
        FoodAttribution(manifest: manifest),
      ]),
    );
  }
}

/// A place tapped on the explore map (site `FoodSheet`).
class FoodSheet extends StatelessWidget {
  const FoodSheet({super.key, required this.place, required this.manifest, required this.hours, required this.onClose, this.distanceM});

  final FoodPlace place;
  final FoodManifest manifest;
  final FoodHoursCache hours;
  final VoidCallback onClose;

  /// Straight-line distance from the walker, when the position is known.
  final double? distanceM;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceSm, TokenSizes.spaceXs, 0),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(top: 4, right: TokenSizes.spaceXs), child: FoodGlyph(kind: place.kind)),
          Expanded(
            child: Semantics(
              header: true,
              child: Text(place.name, style: theme.textTheme.titleLarge?.copyWith(fontSize: TokenSizes.textSheetTitle)),
            ),
          ),
          IconButton(tooltip: context.t('Закрыть карточку'), onPressed: onClose, icon: const Icon(Icons.close)),
        ]),
      ),
      Flexible(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceMd),
          child: FoodCard(
            place: place,
            manifest: manifest,
            hours: hours,
            heading: false,
            distanceLabel: distanceM == null ? null : context.t('≈ {distance} м от вас', {'distance': distanceM!.round()}),
          ),
        ),
      ),
    ]);
  }
}
