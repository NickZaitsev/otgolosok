// A parking place tapped on the explore map (site `parking-sheet.tsx`).
import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../walk_engine/car_route.dart';
import '../legal/legal_links.dart' show openUrl;
import '../player/car/car_walk_panel.dart' show yandexNavigationUrl;
import 'explore_sheets.dart';

final _osmCopyright = Uri.https('www.openstreetmap.org', '/copyright');

class ParkingSheet extends StatelessWidget {
  const ParkingSheet({super.key, required this.place, required this.onClose, this.attribution});

  final ParkingPlace place;
  final String? attribution;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: TokenColors.muted);
    final fee = switch (place.fee) {
      true => 'Платная парковка',
      false => 'Бесплатная парковка',
      null => 'Стоимость парковки неизвестна',
    };
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetHeader(title: place.name, closeLabel: context.t('Закрыть парковку'), onClose: onClose),
      Flexible(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: TokenSizes.spaceMd),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: TokenSizes.spaceXs, children: [
            Text(context.t(place.access == ParkingAccess.public
                ? 'Общественная парковка'
                : 'Доступ на парковку не проверен. Перед поездкой убедитесь, что она открыта для всех.')),
            Text(context.t(fee)),
            if (place.openingHours case final hours?) Text('${context.t('Часы работы')}: $hours'),
            Text(context.t('Перед поездкой проверьте знаки и ограничения на месте.'), style: muted),
            if (attribution case final text?)
              InkWell(
                onTap: () => unawaited(openUrl(context, _osmCopyright)),
                child: Text(text, style: muted?.copyWith(decoration: TextDecoration.underline)),
              ),
          ]),
        ),
      ),
      Padding(
        padding: const EdgeInsets.all(TokenSizes.spaceMd),
        child: FilledButton(
          onPressed: () => unawaited(openUrl(context, yandexNavigationUrl(place.entrance, driving: true), external: true)),
          child: Text(context.t('Доехать до парковки')),
        ),
      ),
    ]);
  }
}
