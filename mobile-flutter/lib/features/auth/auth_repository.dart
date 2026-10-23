import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/config.dart';
import 'pkce.dart';
import 'telegram_callback.dart';
import 'web_authenticator.dart';

/// `GET /api/legal/publication`: whether sign-up is open and which terms version it accepts.
@immutable
class LegalPublication {
  const LegalPublication({required this.ready, required this.termsVersion});

  static LegalPublication fromJson(Object? json) {
    if (json is! Map<String, Object?>) throw const FormatException('publication');
    final ready = json['ready'], version = json['termsVersion'];
    if (ready is! bool || version is! String || version.isEmpty || version.length > 64) throw const FormatException('publication');
    return LegalPublication(ready: ready, termsVersion: version);
  }

  final bool ready;
  final String termsVersion;
}

/// A sign-in failure with a Russian source message the UI translates.
class AuthFailure implements Exception {
  const AuthFailure(this.message, {this.termsRequired = false, this.cancelled = false});

  final String message;

  /// Telegram created no account because the current terms were not accepted.
  final bool termsRequired;

  /// The user closed the Telegram page; not an error worth an alert.
  final bool cancelled;

  @override
  String toString() => 'AuthFailure($message)';
}

/// Russian sources of the sign-in messages (site `src/features/auth/client.ts`, `login.tsx`).
abstract final class AuthMessages {
  static const termsRequired = 'Для регистрации примите актуальные условия использования.';
  static const legalUnavailable = 'Регистрация временно недоступна.';
  static const signInFailed = 'Неверный email или пароль.';
  static const signUpFailed = 'Не удалось создать аккаунт. Возможно, этот email уже используется.';
  static const telegramFailed = 'Не удалось войти через Telegram. Попробуйте ещё раз.';
  static const telegramUnavailable = 'Не удалось открыть вход через Telegram. Попробуйте ещё раз.';
  static const cancelled = 'Вход отменён.';
  static const tooManyAttempts = 'Слишком много попыток. Подождите минуту и повторите.';
  static const sessionFailed = 'Не удалось проверить вход. Попробуйте ещё раз.';
}

/// Email and Telegram sign-in against the site's Better Auth, plus the Telegram PKCE handoff.
class AuthRepository {
  AuthRepository({required this.api, required this.session, required this.web, required this.config});

  final ApiClient api;
  final SessionStore session;
  final WebAuthenticator web;
  final AppConfig config;

  static const telegramStartPath = '/app-auth/telegram';

  Future<LegalPublication> publication() => api.get('/api/legal/publication', LegalPublication.fromJson);

  /// `GET /api/auth/providers` → whether Telegram sign-in is configured on the server.
  Future<bool> telegramAvailable() => api.get('/api/auth/providers', (json) {
        final telegram = json is Map<String, Object?> ? json['telegram'] : null;
        if (telegram is! bool) throw const FormatException('providers');
        return telegram;
      });

  Future<void> signIn({required String email, required String password}) =>
      _complete('/api/auth/sign-in/email', {'email': email, 'password': password}, AuthMessages.signInFailed);

  Future<void> signUp({required String name, required String email, required String password, required String termsVersion}) => _complete(
        '/api/auth/sign-up/email',
        {'name': name, 'email': email, 'password': password, 'termsAccepted': true, 'termsVersion': termsVersion},
        AuthMessages.signUpFailed,
      );

  /// The Telegram start page for a challenge; [termsVersion] is what the user accepted, if anything.
  Uri telegramStartUrl(String challenge, String? termsVersion) =>
      config.siteUrl(telegramStartPath, {'challenge': challenge, 'terms': termsVersion ?? ''});

  /// Opens the site's Telegram page in a Custom Tab and exchanges the returned code for a session.
  ///
  /// Returns the signed-in user. The verifier stays in this call's memory only.
  Future<AuthUser> signInWithTelegram({String? termsVersion}) async {
    final pkce = Pkce.generate();
    final String raw;
    try {
      raw = await web.authenticate(telegramStartUrl(pkce.challenge, termsVersion));
    } on WebAuthCancelled {
      throw const AuthFailure(AuthMessages.cancelled, cancelled: true);
    } on WebAuthUnavailable catch (error) {
      debugPrint('telegram: custom tab ${error.code}');
      throw const AuthFailure(AuthMessages.telegramUnavailable);
    }
    final code = switch (TelegramCallback.parse(raw)) {
      TelegramCode(:final code) => code,
      TelegramError(failure: TelegramFailure.termsRequired) => throw const AuthFailure(AuthMessages.termsRequired, termsRequired: true),
      TelegramError(failure: TelegramFailure.cancelled) => throw const AuthFailure(AuthMessages.cancelled, cancelled: true),
      TelegramError() => throw const AuthFailure(AuthMessages.telegramFailed),
    };
    final Object? json;
    try {
      // Single-use code: never retried.
      json = await api.send('POST', '/api/mobile-auth/exchange', _requireUser, body: {'code': code, 'verifier': pkce.verifier});
    } on ApiError catch (error) {
      if (error.isNetwork || error.isCancelled || (error.status ?? 0) >= 500) rethrow;
      if (error.status == 429) throw const AuthFailure(AuthMessages.tooManyAttempts);
      debugPrint('telegram: exchange ${error.status} ${error.code}');
      throw const AuthFailure(AuthMessages.telegramFailed);
    }
    await session.signedIn(json);
    return session.user!;
  }

  Future<void> _complete(String path, Map<String, Object> body, String fallback) async {
    try {
      await api.send('POST', path, (_) {}, body: body);
    } on ApiError catch (error) {
      if (error.isNetwork || error.isCancelled || (error.status ?? 0) >= 500) rethrow;
      throw AuthFailure(switch (error.code) {
        'LEGAL_UNAVAILABLE' => AuthMessages.legalUnavailable,
        'TERMS_REQUIRED' => AuthMessages.termsRequired,
        _ when error.status == 429 => AuthMessages.tooManyAttempts,
        _ => fallback,
      }, termsRequired: error.code == 'TERMS_REQUIRED');
    }
    // Better Auth set the session cookie; the CSRF token and the user come from the session read.
    await session.refreshCsrf();
    if (session.user == null) throw const AuthFailure(AuthMessages.sessionFailed);
  }

  static Object? _requireUser(Object? json) {
    if (parseSession(json).user == null) throw const FormatException('user');
    return json;
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(
      api: ref.watch(apiProvider),
      session: ref.watch(sessionStoreProvider),
      web: ref.watch(webAuthenticatorProvider),
      config: ref.watch(configProvider),
    ));
