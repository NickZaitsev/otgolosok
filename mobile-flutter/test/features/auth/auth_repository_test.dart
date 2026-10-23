import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/auth/auth_repository.dart';
import 'package:otgolosok/features/auth/pkce.dart';
import 'package:otgolosok/features/auth/web_authenticator.dart';

import 'harness.dart';

void main() {
  late Harness h;
  late AuthRepository auth;
  final code = 'C' * 43;

  setUp(() {
    h = Harness();
    auth = AuthRepository(api: h.api, session: h.session, web: h.web, config: h.config);
  });

  group('Telegram handoff', () {
    test('opens the start page with a challenge and exchanges the code with its verifier', () async {
      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=$code';
      h.server.on('POST /api/mobile-auth/exchange', const Reply(200, {'user': telegramUser, 'csrfToken': 'csrf-t'}));

      final user = await auth.signInWithTelegram(termsVersion: '2026-10-08');

      final opened = h.web.opened.single;
      expect(opened.origin, 'https://otgolosok.online');
      expect(opened.path, '/app-auth/telegram');
      expect(opened.queryParameters['terms'], '2026-10-08');
      final challenge = opened.queryParameters['challenge']!;
      final exchange = h.server.to('POST /api/mobile-auth/exchange').single.body! as Map<String, Object?>;
      expect(exchange['code'], code);
      expect(Pkce.challengeOf(exchange['verifier']! as String), challenge, reason: 'the verifier must match the challenge sent to the site');
      expect(user.id, 'user-2');
      expect(h.session.user?.id, 'user-2');
      expect(h.session.csrfToken, 'csrf-t');
    });

    test('without accepted terms the start page gets an empty terms parameter', () async {
      h.web.answer = (_) async => throw const WebAuthCancelled();
      await expectLater(auth.signInWithTelegram(), throwsA(isA<AuthFailure>().having((f) => f.cancelled, 'cancelled', isTrue)));
      expect(h.web.opened.single.queryParameters['terms'], '');
      expect(h.server.sent, isEmpty);
    });

    final failures = <String, Matcher>{
      'otgolosok-auth://telegram?error=TERMS_REQUIRED': isA<AuthFailure>()
          .having((f) => f.termsRequired, 'termsRequired', isTrue)
          .having((f) => f.message, 'message', AuthMessages.termsRequired),
      'otgolosok-auth://telegram?error=CANCELLED': isA<AuthFailure>().having((f) => f.cancelled, 'cancelled', isTrue),
      'otgolosok-auth://telegram?error=FAILED': isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.telegramFailed),
      'https://otgolosok.online/?code=$code': isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.telegramFailed),
    };
    for (final MapEntry(key: callback, value: matcher) in failures.entries) {
      test('callback $callback is not exchanged', () async {
        h.web.answer = (_) async => callback;
        await expectLater(auth.signInWithTelegram(termsVersion: 'v'), throwsA(matcher));
        expect(h.server.sent, isEmpty);
        expect(h.session.user, isNull);
      });
    }

    test('a Custom Tab that cannot open asks to try again', () async {
      h.web.answer = (_) async => throw const WebAuthUnavailable('NO_BROWSER');
      await expectLater(
        auth.signInWithTelegram(),
        throwsA(isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.telegramUnavailable)),
      );
    });

    test('a rejected code (400 HANDOFF_INVALID) is a generic Telegram failure, sent once', () async {
      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=$code';
      h.server.on('POST /api/mobile-auth/exchange', const Reply(400, {'error': {'code': 'HANDOFF_INVALID', 'message': 'x'}}));
      await expectLater(auth.signInWithTelegram(), throwsA(isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.telegramFailed)));
      expect(h.server.to('POST /api/mobile-auth/exchange'), hasLength(1));
      expect(h.session.user, isNull);
    });

    test('429 on exchange asks to wait and is not retried', () async {
      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=$code';
      h.server.on('POST /api/mobile-auth/exchange', const Reply(429, {'error': {'code': 'RATE_LIMITED', 'message': 'x'}}));
      await expectLater(auth.signInWithTelegram(), throwsA(isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.tooManyAttempts)));
      expect(h.server.to('POST /api/mobile-auth/exchange'), hasLength(1));
    });

    test('an exchange answer without a user is rejected as corrupt', () async {
      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=$code';
      h.server.on('POST /api/mobile-auth/exchange', const Reply(200, {'user': null, 'csrfToken': null}));
      await expectLater(auth.signInWithTelegram(), throwsA(isA<AuthFailure>()));
      expect(h.session.user, isNull);
    });
  });

  group('email', () {
    test('sign-in posts the credentials and reads the session', () async {
      h.server
        ..on('POST /api/auth/sign-in/email', const Reply(200, {'token': 'x'}))
        ..on('GET /api/auth/session', const Reply(200, {'user': passwordUser, 'csrfToken': 'csrf-2'}));
      await auth.signIn(email: 'anna@example.com', password: 'secret-password');
      expect(h.server.to('POST /api/auth/sign-in/email').single.body, {'email': 'anna@example.com', 'password': 'secret-password'});
      expect(h.session.user?.name, 'Анна Петрова');
      expect(h.session.csrfToken, 'csrf-2');
    });

    test('sign-up sends the accepted terms version', () async {
      h.server
        ..on('POST /api/auth/sign-up/email', const Reply(200, {'token': 'x'}))
        ..on('GET /api/auth/session', const Reply(200, {'user': passwordUser, 'csrfToken': 'csrf-2'}));
      await auth.signUp(name: 'Анна', email: 'anna@example.com', password: 'secret-password', termsVersion: '2026-10-08');
      expect(h.server.to('POST /api/auth/sign-up/email').single.body, {
        'name': 'Анна',
        'email': 'anna@example.com',
        'password': 'secret-password',
        'termsAccepted': true,
        'termsVersion': '2026-10-08',
      });
    });

    final errors = <String, (Reply, String)>{
      'Better Auth wrong password': (const Reply(401, {'code': 'INVALID_EMAIL_OR_PASSWORD', 'message': 'Invalid email or password'}), AuthMessages.signInFailed),
      'legal not published': (const Reply(403, {'code': 'LEGAL_UNAVAILABLE', 'message': 'x'}), AuthMessages.legalUnavailable),
      'outdated terms': (const Reply(400, {'code': 'TERMS_REQUIRED', 'message': 'x'}), AuthMessages.termsRequired),
      'rate limited': (const Reply(429, {'message': 'Too many requests'}), AuthMessages.tooManyAttempts),
    };
    for (final MapEntry(key: name, value: (reply, message)) in errors.entries) {
      test('sign-in error: $name', () async {
        h.server.on('POST /api/auth/sign-in/email', reply);
        await expectLater(
          auth.signIn(email: 'anna@example.com', password: 'secret-password'),
          throwsA(isA<AuthFailure>().having((f) => f.message, 'message', message)),
        );
        expect(h.server.to('GET /api/auth/session'), isEmpty);
      });
    }

    test('a server failure is not reported as a wrong password', () async {
      h.server.on('POST /api/auth/sign-in/email', const Reply(500, {'message': 'boom'}));
      await expectLater(auth.signIn(email: 'a@b', password: 'secret-password'), throwsA(isA<ApiError>()));
      expect(h.server.to('POST /api/auth/sign-in/email'), hasLength(1), reason: 'sign-in is not idempotent');
    });

    test('a sign-in whose session read finds no user fails', () async {
      h.server
        ..on('POST /api/auth/sign-in/email', const Reply(200, {}))
        ..on('GET /api/auth/session', const Reply(200, {'user': null, 'csrfToken': null}));
      await expectLater(
        auth.signIn(email: 'a@b', password: 'secret-password'),
        throwsA(isA<AuthFailure>().having((f) => f.message, 'message', AuthMessages.sessionFailed)),
      );
    });
  });

  test('legal publication fails closed on a malformed answer', () async {
    h.server.on('GET /api/legal/publication', const Reply(200, {'ready': 'yes', 'termsVersion': '2026-10-08'}));
    await expectLater(auth.publication(), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'CORRUPT')));
  });
}
