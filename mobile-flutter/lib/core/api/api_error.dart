/// A failed API call, shaped like the site's `{error:{code,message}}` responses.
class ApiError implements Exception {
  const ApiError({
    required this.message,
    this.status,
    this.code,
    this.retryable = false,
    this.retryAfter = Duration.zero,
    this.movedToShare,
  });

  /// The server answered with something the validator rejected.
  const ApiError.corrupt([String message = 'Сервис вернул повреждённые данные.'])
      : this(message: message, code: 'CORRUPT');

  /// No answer at all: offline, DNS, TLS or a timeout.
  const ApiError.network({bool timedOut = false})
      : this(
          message: timedOut ? 'Сервер не ответил вовремя.' : 'Нет соединения с сервером.',
          code: timedOut ? 'TIMEOUT' : 'NETWORK',
          retryable: true,
        );

  /// The request was cancelled by the app; never shown to the user.
  const ApiError.cancelled() : this(message: 'Запрос отменён.', code: 'CANCELLED');

  /// Russian source text; the UI translates it like every other dictionary string.
  final String message;
  final int? status;
  final String? code;
  final bool retryable;

  /// Wait requested by the server, already capped at the retry budget.
  final Duration retryAfter;

  /// `410 WALK_MOVED`: the catalogue walk now lives at this share token.
  final String? movedToShare;

  bool get isNetwork => code == 'NETWORK' || code == 'TIMEOUT';
  bool get isCancelled => code == 'CANCELLED';
  bool get isUnauthorized => status == 401;

  /// Statuses after which an offline copy may stand in (site `offline.ts`).
  bool get allowsOfflineFallback => isNetwork || status == 408 || status == 429 || (status != null && status! >= 500);

  @override
  String toString() => 'ApiError($status ${code ?? ''}: $message)';
}
