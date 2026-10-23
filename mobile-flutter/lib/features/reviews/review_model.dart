import 'package:flutter/foundation.dart';

import '../../core/i18n/translations.dart';
import '../../walk_engine/json_read.dart';
import '../walks/format.dart';

/// Longest review text in Unicode code points (site `REVIEW_TEXT_MAX`).
const reviewTextMax = 1000;

/// The walk a review, an improvement request or a launch belongs to (site `ReviewTarget`).
@immutable
sealed class ReviewTarget {
  const ReviewTarget();

  /// `/…/reviews` of the walk.
  String get reviewsPath;

  /// Stable key for drafts (site `targetKey`).
  String get key;

  @override
  bool operator ==(Object other) => other is ReviewTarget && other.key == key;

  @override
  int get hashCode => key.hashCode;
}

class CatalogReviewTarget extends ReviewTarget {
  const CatalogReviewTarget(this.id);
  final String id;
  @override
  String get reviewsPath => '/api/story-walks/${Uri.encodeComponent(id)}/reviews';
  @override
  String get key => 'catalog:$id';
}

class SharedReviewTarget extends ReviewTarget {
  const SharedReviewTarget(this.token);
  final String token;
  @override
  String get reviewsPath => '/api/story-walks/shared/${Uri.encodeComponent(token)}/reviews';
  @override
  String get key => 'share:$token';
}

class AccountReviewTarget extends ReviewTarget {
  const AccountReviewTarget(this.id);
  final String id;
  @override
  String get reviewsPath => '/api/me/walks/${Uri.encodeComponent(id)}/reviews';
  @override
  String get key => 'account:$id';
}

enum ReviewStatus { pending, published, hidden }

@immutable
class ReviewSummary {
  const ReviewSummary({required this.average, required this.count});

  /// Null exactly when [count] is 0.
  final double? average;
  final int count;

  /// `validateSummary` of the site; also used by walk cards.
  static ReviewSummary fromJson(Object? json) {
    final item = readMap(json);
    final count = item['count'];
    if (!jsIsSafeInteger(count) || (count! as num) < 0) failFormat('Неверное число оценок.');
    final average = item['average'];
    final valid = (count as num) == 0
        ? item.containsKey('average') && average == null
        : average is num && average >= 1 && average <= 5;
    if (!valid) failFormat('Неверная средняя оценка.');
    return ReviewSummary(average: (average as num?)?.toDouble(), count: count.toInt());
  }

  Map<String, Object?> toJson() => {'average': average, 'count': count};

  @override
  bool operator ==(Object other) => other is ReviewSummary && other.average == average && other.count == count;

  @override
  int get hashCode => Object.hash(average, count);
}

@immutable
class PublicReview {
  const PublicReview({required this.id, required this.author, required this.rating, required this.text, required this.createdAt});
  final String id;
  final String author;
  final int rating;
  final String text;

  /// As sent by the server; shown as a date only when it parses.
  final String createdAt;
}

@immutable
class MyReview {
  const MyReview({required this.rating, required this.text, required this.status, required this.updatedAt});
  final int rating;
  final String text;
  final ReviewStatus status;
  final String updatedAt;
}

@immutable
class ReviewPage {
  const ReviewPage({required this.summary, required this.reviews, required this.nextCursor, required this.mine});
  final ReviewSummary summary;
  final List<PublicReview> reviews;
  final String? nextCursor;
  final MyReview? mine;
}

@immutable
class ReviewWrite {
  const ReviewWrite({required this.summary, required this.mine});
  final ReviewSummary summary;
  final MyReview? mine;
}

int _rating(Object? value) {
  if (!jsIsInteger(value) || (value! as num) < 1 || (value as num) > 5) failFormat('Неверная оценка.');
  return value.toInt();
}

MyReview? _mine(Object? value) {
  if (value == null) return null;
  final item = readMap(value);
  final status = ReviewStatus.values.where((s) => s.name == item['status']).firstOrNull ?? failFormat('Неверный статус отзыва.');
  return MyReview(rating: _rating(item['rating']), text: readString(item['text']), status: status, updatedAt: readString(item['updatedAt']));
}

/// `validateReviewPage`: `mine` must be present (null or an object), as on the site.
ReviewPage validateReviewPage(Object? json) {
  final page = readMap(json);
  final reviews = page['reviews'];
  if (reviews is! List<Object?>) failFormat('Ожидался список отзывов.');
  final cursor = page['nextCursor'];
  if (!page.containsKey('nextCursor') || (cursor != null && cursor is! String)) failFormat('Неверный курсор.');
  if (!page.containsKey('mine')) failFormat('Неверный отзыв.');
  return ReviewPage(
    summary: ReviewSummary.fromJson(page['summary']),
    reviews: [
      for (final raw in reviews)
        () {
          final item = readMap(raw);
          return PublicReview(
            id: readString(item['id']),
            author: readString(item['author']),
            rating: _rating(item['rating']),
            text: readString(item['text']),
            createdAt: readString(item['createdAt']),
          );
        }(),
    ],
    nextCursor: cursor as String?,
    mine: _mine(page['mine']),
  );
}

ReviewWrite validateReviewWrite(Object? json) {
  final item = readMap(json);
  if (!item.containsKey('mine')) failFormat('Неверный отзыв.');
  return ReviewWrite(summary: ReviewSummary.fromJson(item['summary']), mine: _mine(item['mine']));
}

/// «12 оценок» / "12 ratings" / «12 次评分».
String ratingCountLabel(int count, AppLocale locale) => switch (locale) {
      AppLocale.zh => '$count 次评分',
      AppLocale.en => '$count ${count == 1 ? 'rating' : 'ratings'}',
      AppLocale.ru => '$count ${switch (ruPlural(count)) {
          RuPlural.one => 'оценка',
          RuPlural.few => 'оценки',
          RuPlural.many => 'оценок',
        }}',
    };

/// «★ 4,6 · 12 оценок», or "" while there is nothing to show.
String formatRatingSummary(ReviewSummary? summary, AppLocale locale) {
  final average = summary?.average;
  if (summary == null || summary.count == 0 || average == null) return '';
  return '★ ${formatFixed(average, locale)} · ${ratingCountLabel(summary.count, locale)}';
}

/// Unicode code points, as the site counts `[...text].length`.
int codePoints(String text) => text.runes.length;
