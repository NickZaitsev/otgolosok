import 'pkce.dart';

/// Why the Telegram sign-in page sent the app back without a code (site `AppAuthError`).
enum TelegramFailure { termsRequired, cancelled, failed }

/// The result the site page returns through `otgolosok-auth://telegram?…`.
sealed class TelegramCallback {
  const TelegramCallback();

  static const scheme = 'otgolosok-auth';
  static const host = 'telegram';

  /// Fails closed: anything but a well-formed callback with exactly one valid code is [TelegramError].
  static TelegramCallback parse(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri == null || uri.scheme != scheme || uri.host != host || uri.hasFragment) {
      return const TelegramError(TelegramFailure.failed);
    }
    final query = uri.queryParametersAll;
    final codes = query['code'] ?? const [];
    final errors = query['error'] ?? const [];
    if (codes.length == 1 && errors.isEmpty && Pkce.isValue(codes.single)) return TelegramCode(codes.single);
    if (codes.isEmpty && errors.length == 1) {
      return TelegramError(switch (errors.single) {
        'TERMS_REQUIRED' => TelegramFailure.termsRequired,
        'CANCELLED' => TelegramFailure.cancelled,
        _ => TelegramFailure.failed,
      });
    }
    return const TelegramError(TelegramFailure.failed);
  }
}

final class TelegramCode extends TelegramCallback {
  const TelegramCode(this.code);

  /// One-time handoff code; exchanged once and never logged.
  final String code;

  @override
  String toString() => 'TelegramCode(***)';
}

final class TelegramError extends TelegramCallback {
  const TelegramError(this.failure);

  final TelegramFailure failure;

  @override
  bool operator ==(Object other) => other is TelegramError && other.failure == failure;

  @override
  int get hashCode => failure.hashCode;

  @override
  String toString() => 'TelegramError($failure)';
}
