import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';
import 'top_walks_view.dart';

/// «Тренды» (site `trends.tsx`): the public top with city and metro filters.
class TrendsScreen extends StatelessWidget {
  const TrendsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: TopWalksView(
          filterable: true,
          header: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(context.t('Выбор слушателей'), style: theme.textTheme.labelSmall),
              Semantics(header: true, child: Text(context.t('Тренды'), style: theme.textTheme.headlineLarge)),
              const SizedBox(height: 4),
              Text(
                '${context.t('Популярные прогулки с оценками слушателей.')} ${context.t('Для старта и финиша указано ближайшее метро.')}',
                style: theme.textTheme.bodySmall,
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
