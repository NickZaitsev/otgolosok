import 'dart:convert';

import '../../core/api/api_client.dart';
import '../../core/settings/settings_store.dart';
import 'review_model.dart';

/// Reviews of one walk. A signed-in viewer is identified by the session (CSRF on writes), a guest
/// by the device key `X-Review-Key` (site `reviews/api.ts`).
class ReviewsApi {
  const ReviewsApi(this._api);
  final ApiClient _api;

  Future<ReviewPage> load(ReviewTarget target, {String? cursor}) =>
      _api.get(target.reviewsPath, validateReviewPage, query: cursor == null ? null : {'cursor': cursor}, guestKey: true);

  /// PUT is an upsert, so a retry after a lost answer is safe.
  Future<ReviewWrite> save(ReviewTarget target, ReviewInput input) => _api.send('PUT', '${target.reviewsPath}/mine', validateReviewWrite,
      body: {'rating': input.rating, 'text': input.text}, idempotent: true, guestKey: true);

  /// Deleting an absent review succeeds too, so a retry is safe.
  Future<ReviewWrite> delete(ReviewTarget target) =>
      _api.send('DELETE', '${target.reviewsPath}/mine', validateReviewWrite, idempotent: true, guestKey: true);
}

/// What the author sends: 1–5 stars and an optional text.
class ReviewInput {
  const ReviewInput({required this.rating, required this.text});
  final int rating;
  final String text;
}

/// A form left by a failed send, kept per walk so the next opening restores it (site `device.ts`).
/// Storage failures never break the walk screen: the draft is a convenience only.
class ReviewDrafts {
  const ReviewDrafts(this._settings);
  final SettingsStore _settings;

  static String _key(ReviewTarget target) => 'reviews.draft.v1.${target.key}';

  ReviewInput? read(ReviewTarget target) {
    try {
      final value = jsonDecode(_settings.readString(_key(target)) ?? 'null');
      if (value is! Map<String, Object?>) return null;
      final rating = value['rating'], text = value['text'];
      if (rating is! int || rating < 0 || rating > 5 || text is! String) return null;
      return ReviewInput(rating: rating, text: text);
    } on FormatException {
      return null;
    }
  }

  Future<void> write(ReviewTarget target, ReviewInput input) async {
    try {
      await _settings.writeString(_key(target), jsonEncode({'rating': input.rating, 'text': input.text}));
    } on Exception {
      // Nothing to do: the review itself is still being sent.
    }
  }

  Future<void> clear(ReviewTarget target) async {
    try {
      await _settings.remove(_key(target));
    } on Exception {
      // A stale draft is overwritten by the next send.
    }
  }
}
