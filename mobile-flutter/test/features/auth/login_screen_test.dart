import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/auth/login_screen.dart';

import 'harness.dart';

void main() {
  late Harness h;

  setUp(() => h = Harness());

  Future<void> open(WidgetTester tester, {bool ready = true, bool telegram = true, String? returnTo}) {
    h.server
      ..on('GET /api/legal/publication', Reply(200, {'ready': ready, 'termsVersion': '2026-10-08'}))
      ..on('GET /api/auth/providers', Reply(200, {'telegram': telegram}));
    return h.pump(tester, location: '/login', screens: {'/login': (_) => LoginScreen(returnTo: returnTo)});
  }

  FilledButton submit(WidgetTester tester) => tester.widget<FilledButton>(find.byKey(const ValueKey('submit')));
  FilledButton telegramButton(WidgetTester tester) => tester.widget(find.byKey(const ValueKey('telegram')));

  Future<void> fill(WidgetTester tester, {String? name, required String email, required String password}) async {
    if (name != null) await tester.enterText(find.byKey(const ValueKey('name')), name);
    await tester.enterText(find.byKey(const ValueKey('email')), email);
    await tester.enterText(find.byKey(const ValueKey('password')), password);
  }

  group('sign-up is gated by the legal publication', () {
    testWidgets('documents not published: sign-up and Telegram stay disabled', (tester) async {
      await open(tester, ready: false);
      await tester.tap(find.text('Нет аккаунта? Зарегистрироваться'));
      await tester.pumpAndSettle();

      expect(find.text('Регистрация временно недоступна.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('terms')));
      await tester.pumpAndSettle();
      expect(submit(tester).onPressed, isNull);
      expect(telegramButton(tester).onPressed, isNull);
    });

    testWidgets('published: the terms checkbox enables sign-up, which sends the published version', (tester) async {
      await open(tester);
      await tester.tap(find.text('Нет аккаунта? Зарегистрироваться'));
      await tester.pumpAndSettle();
      expect(submit(tester).onPressed, isNull, reason: 'terms not accepted yet');

      await tester.tap(find.byKey(const ValueKey('terms')));
      await tester.pumpAndSettle();
      expect(submit(tester).onPressed, isNotNull);

      h.server
        ..on('POST /api/auth/sign-up/email', const Reply(200, {}))
        ..on('GET /api/auth/session', const Reply(200, {'user': passwordUser, 'csrfToken': 'c'}));
      await fill(tester, name: ' Анна ', email: 'anna@example.com', password: 'long-enough-1');
      await tester.tap(find.byKey(const ValueKey('submit')));
      await tester.pumpAndSettle();

      final body = h.server.to('POST /api/auth/sign-up/email').single.body! as Map<String, Object?>;
      expect(body['termsVersion'], '2026-10-08');
      expect(body['termsAccepted'], isTrue);
      expect(body['name'], 'Анна');
      expect(h.location, '/account');
    });

    testWidgets('a failed publication request can be retried', (tester) async {
      h.server
        ..on('GET /api/legal/publication', const Reply(503, {'error': {'code': 'UNAVAILABLE', 'message': 'x'}}))
        ..on('GET /api/auth/providers', const Reply(200, {'telegram': false}));
      await h.pump(tester, location: '/login', screens: {'/login': (_) => const LoginScreen()});
      await tester.tap(find.text('Нет аккаунта? Зарегистрироваться'));
      await tester.pumpAndSettle();
      expect(find.text('Повторить'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('terms')));
      await tester.pumpAndSettle();
      expect(submit(tester).onPressed, isNull);

      h.server.on('GET /api/legal/publication', const Reply(200, {'ready': true, 'termsVersion': '2026-10-08'}));
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();
      expect(submit(tester).onPressed, isNotNull);
    });
  });

  testWidgets('sign-in validates the fields before sending anything', (tester) async {
    await open(tester, telegram: false);
    await fill(tester, email: 'anna', password: 'short');
    await tester.tap(find.byKey(const ValueKey('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Проверьте адрес email.'), findsOneWidget);
    expect(find.text('Пароль должен содержать от 10 до 128 символов.'), findsOneWidget);
    expect(h.server.to('POST /api/auth/sign-in/email'), isEmpty);
  });

  testWidgets('a wrong password is shown and the screen stays', (tester) async {
    await open(tester, telegram: false);
    h.server.on('POST /api/auth/sign-in/email', const Reply(401, {'code': 'INVALID_EMAIL_OR_PASSWORD', 'message': 'Invalid email or password'}));
    await fill(tester, email: 'anna@example.com', password: 'wrong-password');
    await tester.tap(find.byKey(const ValueKey('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Неверный email или пароль.'), findsOneWidget);
    expect(h.location, '/login');
  });

  testWidgets('successful sign-in opens a safe returnTo', (tester) async {
    await open(tester, telegram: false, returnTo: '/account/walks');
    h.server
      ..on('POST /api/auth/sign-in/email', const Reply(200, {}))
      ..on('GET /api/auth/session', const Reply(200, {'user': passwordUser, 'csrfToken': 'c'}));
    await fill(tester, email: 'anna@example.com', password: 'long-enough-1');
    await tester.tap(find.byKey(const ValueKey('submit')));
    await tester.pumpAndSettle();
    expect(h.location, '/account/walks');
  });

  testWidgets('Telegram TERMS_REQUIRED switches to sign-up and clears the checkbox', (tester) async {
    await open(tester);
    h.web.answer = (_) async => 'otgolosok-auth://telegram?error=TERMS_REQUIRED';
    await tester.tap(find.byKey(const ValueKey('terms')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('telegram')));
    await tester.pumpAndSettle();

    expect(h.web.opened.single.queryParameters['terms'], '2026-10-08');
    expect(find.text('Регистрация'), findsOneWidget);
    expect(find.text('Для регистрации примите актуальные условия использования.'), findsOneWidget);
    expect(tester.widget<Checkbox>(find.byKey(const ValueKey('terms'))).value, isFalse);
  });
}
