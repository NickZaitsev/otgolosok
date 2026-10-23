import 'package:flutter/foundation.dart';

import 'review_model.dart';
import 'reviews_api.dart';

enum ReviewsState { loading, ready, unavailable }

/// The outcome of a send; the widget turns [error] into a message.
sealed class ReviewActionResult {
  const ReviewActionResult();
}

class ReviewActionDone extends ReviewActionResult {
  const ReviewActionDone(this.status);

  /// Status of the stored review.
  final ReviewStatus? status;
}

class ReviewActionFailed extends ReviewActionResult {
  const ReviewActionFailed(this.error);
  final Object error;
}

/// Reviews of one walk on the walk screen (site `use-walk-reviews.ts`). Reviews never break the
/// walk: any load failure, network or schema, ends in [ReviewsState.unavailable] with a retry.
class WalkReviewsController extends ChangeNotifier {
  WalkReviewsController({required this.target, required this._api, required this._drafts}) {
    reload();
  }

  final ReviewTarget target;
  final ReviewsApi _api;
  final ReviewDrafts _drafts;

  ReviewsState _state = ReviewsState.loading;
  ReviewSummary? _summary;
  List<PublicReview> _reviews = const [];
  String? _nextCursor;
  MyReview? _mine;
  bool _loadingMore = false;
  bool _disposed = false;
  int _generation = 0;

  ReviewsState get state => _state;
  ReviewSummary? get summary => _summary;
  List<PublicReview> get reviews => _reviews;
  String? get nextCursor => _nextCursor;
  MyReview? get mine => _mine;
  bool get loadingMore => _loadingMore;

  /// The unsent form of this walk, if a send failed before.
  ReviewInput? get draft => _drafts.read(target);

  Future<void> reload() async {
    final generation = ++_generation;
    _state = ReviewsState.loading;
    _notify();
    try {
      final page = await _api.load(target);
      if (_disposed || generation != _generation) return;
      _summary = page.summary;
      _reviews = page.reviews;
      _nextCursor = page.nextCursor;
      _mine = page.mine;
      _state = ReviewsState.ready;
    } on Exception {
      if (_disposed || generation != _generation) return;
      _state = ReviewsState.unavailable;
    }
    _notify();
  }

  /// The next page; a failure keeps the loaded part and the button, so the user can try again.
  Future<void> loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore || _state != ReviewsState.ready) return;
    final generation = _generation;
    _loadingMore = true;
    _notify();
    try {
      final page = await _api.load(target, cursor: cursor);
      if (_disposed || generation != _generation) return;
      _summary = page.summary;
      _reviews = [..._reviews, ...page.reviews];
      _nextCursor = page.nextCursor;
    } on Exception {
      // Kept as is; the button stays.
    } finally {
      _loadingMore = false;
      _notify();
    }
  }

  /// Sends the review; the form is kept as a draft until the server accepts it.
  Future<ReviewActionResult> save(ReviewInput input) async {
    await _drafts.write(target, input);
    try {
      final result = await _api.save(target, input);
      await _drafts.clear(target);
      _apply(result);
      return ReviewActionDone(result.mine?.status);
    } on Exception catch (error) {
      return ReviewActionFailed(error);
    }
  }

  void _apply(ReviewWrite result) {
    _summary = result.summary;
    _mine = result.mine;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
