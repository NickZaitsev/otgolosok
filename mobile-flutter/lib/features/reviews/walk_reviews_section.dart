import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import 'review_model.dart';
import 'walk_reviews_controller.dart';

/// Summary and published texts (site `walk-reviews.tsx`); the author's own form opens via [onRate].
class WalkReviewsSection extends StatelessWidget {
  const WalkReviewsSection({super.key, required this.reviews, required this.onRate});
  final WalkReviewsController reviews;
  final VoidCallback onRate;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: reviews,
        builder: (context, _) {
          final theme = Theme.of(context);
          switch (reviews.state) {
            case ReviewsState.unavailable:
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(context.t('Отзывы сейчас недоступны.')),
                TextButton(onPressed: reviews.reload, child: Text(context.t('Повторить'))),
              ]);
            case ReviewsState.loading:
              return Text(context.t('Загружаем отзывы…'));
            case ReviewsState.ready:
              final summary = formatRatingSummary(reviews.summary, context.appLocale);
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(summary.isEmpty ? context.t('Оценок пока нет') : summary, style: theme.textTheme.titleMedium),
                OutlinedButton(
                  onPressed: onRate,
                  child: Text(reviews.mine == null ? context.t('Оставить отзыв') : context.t('Изменить отзыв')),
                ),
                if (reviews.reviews.isNotEmpty)
                  Semantics(
                    label: context.t('Отзывы'),
                    container: true,
                    child: Column(children: [for (final review in reviews.reviews) _ReviewTile(review: review)]),
                  ),
                if (reviews.nextCursor != null)
                  OutlinedButton(
                    onPressed: reviews.loadingMore ? null : reviews.loadMore,
                    child: Text(reviews.loadingMore ? context.t('Загружаем…') : context.t('Показать ещё')),
                  ),
              ]);
          }
        },
      );
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review});
  final PublicReview review;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final created = DateTime.tryParse(review.createdAt);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(review.author, style: theme.textTheme.titleMedium),
          Semantics(
            label: context.t('Оценка {rating} из 5', {'rating': review.rating}),
            excludeSemantics: true,
            child: Text('${'★' * review.rating}${'☆' * (5 - review.rating)}', style: const TextStyle(color: TokenColors.mapOrange)),
          ),
          if (created != null) Text(MaterialLocalizations.of(context).formatCompactDate(created.toLocal()), style: theme.textTheme.bodySmall),
        ]),
        if (review.text.isNotEmpty) Text(review.text),
      ]),
    );
  }
}
