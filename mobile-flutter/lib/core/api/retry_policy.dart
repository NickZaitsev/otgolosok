import 'dart:math';

import 'api_error.dart';

/// The site's `loadJson` retry rules (src/features/walks/walk-loader.ts): at most three attempts,
/// network errors, 429 and 5xx are retried after 500·2ⁿ ms or `Retry-After`, capped at 5 s,
/// plus up to 250 ms of jitter; a `Retry-After` above 5 s fails at once.
class RetryPolicy {
  const RetryPolicy({this.attempts = 3, this._random});

  static const maxDelay = Duration(seconds: 5);
  static const timeout = Duration(seconds: 20);

  final int attempts;
  final Random? _random;

  static bool retryableStatus(int status) => status == 429 || status >= 500;

  /// Whether a response with [status] and the raw `Retry-After` header may be retried.
  static bool retryableResponse(int status, Duration retryAfter) =>
      retryableStatus(status) && !(status == 429 && retryAfter > maxDelay);

  /// Seconds in `Retry-After`; HTTP dates and garbage count as no hint, like the site.
  static Duration parseRetryAfter(String? header) {
    if (header == null || !RegExp(r'^\d+(?:\.\d+)?$').hasMatch(header)) return Duration.zero;
    return Duration(milliseconds: (double.parse(header) * 1000).round());
  }

  /// The wait before attempt `attempt + 1`, or null when [error] must not be retried.
  Duration? delayAfter(int attempt, ApiError error) {
    if (!error.retryable || error.isCancelled || attempt + 1 >= attempts) return null;
    final hinted = error.retryAfter > Duration.zero ? error.retryAfter : Duration(milliseconds: 500 * (1 << attempt));
    final capped = hinted > maxDelay ? maxDelay : hinted;
    return capped + Duration(milliseconds: (_random ?? _shared).nextInt(250));
  }

  static final _shared = Random();
}
