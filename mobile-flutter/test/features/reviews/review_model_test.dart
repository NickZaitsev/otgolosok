import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/reviews/review_model.dart';
import 'package:otgolosok/features/reviews/review_sheet.dart';

Map<String, Object?> _page({Object? summary, Object? reviews, Object? mine, bool withMine = true, Object? cursor}) => {
      'summary': summary ?? {'average': 4.5, 'count': 2},
      'reviews': reviews ??
          [
            {'id': 'r1', 'author': 'Анна', 'rating': 5, 'text': 'Отлично', 'createdAt': '2026-10-01T10:00:00.000Z'},
          ],
      'nextCursor': cursor,
      if (withMine) 'mine': mine,
    };

void main() {
  group('validateReviewPage rejects what the site rejects', () {
    final table = <String, (Map<String, Object?>, bool)>{
      'a page with ratings': (_page(), true),
      'no ratings yet': (_page(summary: {'average': null, 'count': 0}, reviews: <Object?>[]), true),
      'my pending review': (_page(mine: {'rating': 3, 'text': '', 'status': 'pending', 'updatedAt': '2026-10-02T10:00:00.000Z'}), true),
      'a further page': (_page(cursor: 'abc'), true),
      'an average without ratings': (_page(summary: {'average': 4, 'count': 0}), false),
      'ratings without an average': (_page(summary: {'average': null, 'count': 3}), false),
      'an average above five': (_page(summary: {'average': 5.5, 'count': 3}), false),
      'a fractional count': (_page(summary: {'average': 4, 'count': 1.5}), false),
      'a review rated zero': (
        _page(reviews: [
          {'id': 'r1', 'author': 'Анна', 'rating': 0, 'text': '', 'createdAt': '2026-10-01T10:00:00.000Z'},
        ]),
        false
      ),
      'a fractional rating': (
        _page(reviews: [
          {'id': 'r1', 'author': 'Анна', 'rating': 4.5, 'text': '', 'createdAt': '2026-10-01T10:00:00.000Z'},
        ]),
        false
      ),
      'an unknown status of my review': (_page(mine: {'rating': 3, 'text': '', 'status': 'draft', 'updatedAt': 'x'}), false),
      'no «mine» field at all': (_page(withMine: false), false),
      'a cursor that is not text': (_page(cursor: 3), false),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () {
        if (value.$2) {
          expect(validateReviewPage(value.$1).summary, isA<ReviewSummary>());
        } else {
          expect(() => validateReviewPage(value.$1), throwsFormatException);
        }
      });
    }
  });

  test('a saved review returns the new summary and my status', () {
    final write = validateReviewWrite({
      'summary': {'average': 4, 'count': 1},
      'mine': {'rating': 4, 'text': 'Хорошо', 'status': 'published', 'updatedAt': '2026-10-02T10:00:00.000Z'},
    });
    expect(write.summary, const ReviewSummary(average: 4, count: 1));
    expect(write.mine?.status, ReviewStatus.published);
    expect(() => validateReviewWrite({'summary': {'average': null, 'count': 0}}), throwsFormatException);
  });

  group('rating summary', () {
    final table = <String, (ReviewSummary?, AppLocale, String)>{
      'nothing before ratings arrive': (null, AppLocale.ru, ''),
      'nothing without ratings': (const ReviewSummary(average: null, count: 0), AppLocale.ru, ''),
      'one rating': (const ReviewSummary(average: 5, count: 1), AppLocale.ru, '★ 5,0 · 1 оценка'),
      'a few ratings': (const ReviewSummary(average: 4.24, count: 3), AppLocale.ru, '★ 4,2 · 3 оценки'),
      'many ratings': (const ReviewSummary(average: 4.6, count: 12), AppLocale.ru, '★ 4,6 · 12 оценок'),
      'English': (const ReviewSummary(average: 4.6, count: 1), AppLocale.en, '★ 4.6 · 1 rating'),
      'Chinese': (const ReviewSummary(average: 4.6, count: 12), AppLocale.zh, '★ 4.6 · 12 次评分'),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () => expect(formatRatingSummary(value.$1, value.$2), value.$3));
    }
  });

  test('the text limit counts code points, so emoji are not cut in half', () {
    const limit = CodePointLimit(3);
    const old = TextEditingValue.empty;
    expect(limit.formatEditUpdate(old, const TextEditingValue(text: '😀😀😀')).text, '😀😀😀');
    expect(limit.formatEditUpdate(old, const TextEditingValue(text: '😀😀😀😀')).text, '😀😀😀');
    expect(limit.formatEditUpdate(old, const TextEditingValue(text: 'abcd')).text, 'abc');
  });
}
