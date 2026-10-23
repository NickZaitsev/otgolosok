import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/account/account_screen.dart';

import '../auth/harness.dart';

void main() {
  late Harness h;

  setUp(() {
    h = Harness();
    h.server
      ..on('GET /api/me/favorites', const Reply(200, {'favorites': <Object?>[], 'nextCursor': null}))
      ..on('GET /api/me/requests', const Reply(200, {'requests': <Object?>[], 'nextCursor': null}));
  });

  Future<void> open(WidgetTester tester, Map<String, Object?> user) async {
    await h.signIn(user);
    await h.pump(tester, location: '/account', screens: {'/account': (_) => const AccountScreen()});
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  Future<void> confirm(WidgetTester tester) async {
    await tester.tap(find.byKey(const ValueKey('confirm')));
    await tester.pumpAndSettle();
  }

  testWidgets('a guest is invited to sign in', (tester) async {
    h.server.on('GET /api/auth/session', const Reply(200, {'user': null, 'csrfToken': null}));
    await tester.runAsync(h.session.load);
    await h.pump(tester, location: '/account', screens: {'/account': (_) => const AccountScreen()});
    expect(find.text('Ваши прогулки — с вами'), findsOneWidget);
    await tapText(tester, 'Войти');
    expect(h.opened, '/login?returnTo=%2Faccount');
  });

  group('rename', () {
    testWidgets('saves the trimmed name and updates the session', (tester) async {
      await open(tester, passwordUser);
      h.server.on('PATCH /api/me', const Reply(200, {'user': {'id': 'user-1', 'name': 'Анна Иванова', 'email': 'anna@example.com'}}));

      await tester.tap(find.byTooltip('Редактировать профиль'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('rename')), '  Анна Иванова ');
      await tester.pump();
      await tapText(tester, 'Сохранить изменения');

      expect(h.server.to('PATCH /api/me').single.body, {'name': 'Анна Иванова'});
      expect(h.server.to('PATCH /api/me').single.headers['X-CSRF-Token'], 'csrf-1');
      expect(h.session.user?.name, 'Анна Иванова');
      expect(find.text('Имя сохранено.'), findsOneWidget);
      expect(find.byKey(const ValueKey('rename')), findsNothing);
    });

    testWidgets('an unchanged or empty name cannot be saved', (tester) async {
      await open(tester, passwordUser);
      await tester.tap(find.byTooltip('Редактировать профиль'));
      await tester.pumpAndSettle();
      FilledButton save() => tester.widget(find.widgetWithText(FilledButton, 'Сохранить изменения'));
      expect(save().onPressed, isNull);
      await tester.enterText(find.byKey(const ValueKey('rename')), '   ');
      await tester.pump();
      expect(save().onPressed, isNull);
    });

    testWidgets('a failure keeps the form open with the message', (tester) async {
      await open(tester, passwordUser);
      h.server.on('PATCH /api/me', const Reply(400, {'error': {'code': 'BAD_REQUEST', 'message': 'Bad request'}}));
      await tester.tap(find.byTooltip('Редактировать профиль'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('rename')), 'Анна');
      await tester.pump();
      await tapText(tester, 'Сохранить изменения');
      expect(find.text('Не удалось сохранить имя.'), findsOneWidget);
      expect(h.session.user?.name, 'Анна Петрова');
    });
  });

  group('delete', () {
    testWidgets('a password account deletes with its password, clears the session and leaves', (tester) async {
      await open(tester, passwordUser);
      h.server.on('DELETE /api/me', const Reply(200, {'success': true}));
      await tapText(tester, 'Удалить аккаунт');
      expect(find.text('Удалить аккаунт навсегда?'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('delete-password')), 'secret-password');
      await confirm(tester);

      expect(h.server.to('DELETE /api/me').single.body, {'password': 'secret-password'});
      expect(h.session.user, isNull);
      expect(h.location, '/');
    });

    testWidgets('a wrong password is reported and the account stays', (tester) async {
      await open(tester, passwordUser);
      h.server.on('DELETE /api/me', const Reply(403, {'error': {'code': 'PASSWORD_INVALID', 'message': 'Неверный пароль.'}}));
      await tapText(tester, 'Удалить аккаунт');
      await tester.enterText(find.byKey(const ValueKey('delete-password')), 'wrong-password');
      await confirm(tester);

      expect(find.text('Неверный пароль.'), findsOneWidget);
      expect(h.session.user?.id, 'user-1');
      expect(h.location, '/account');
    });

    testWidgets('401 means the session is gone: the screen falls back to the guest view', (tester) async {
      await open(tester, passwordUser);
      h.server.on('DELETE /api/me', const Reply(401, {'error': {'code': 'UNAUTHORIZED', 'message': 'Войдите в аккаунт.'}}));
      await tapText(tester, 'Удалить аккаунт');
      await tester.enterText(find.byKey(const ValueKey('delete-password')), 'secret-password');
      await confirm(tester);

      expect(h.session.user, isNull);
      expect(find.text('Ваши прогулки — с вами'), findsOneWidget);
    });

    testWidgets('a Telegram account confirms in Telegram first, then deletes without a password', (tester) async {
      await open(tester, telegramUser);
      await tapText(tester, 'Удалить аккаунт');
      expect(find.byKey(const ValueKey('delete-password')), findsNothing);
      expect(find.text('Подтвердить в Telegram'), findsOneWidget);

      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=${'D' * 43}';
      h.server.on('POST /api/mobile-auth/exchange',
          Reply(200, {'user': {...telegramUser, 'requiresReauthentication': false}, 'csrfToken': 'csrf-fresh'}));
      await confirm(tester);
      expect(h.web.opened.single.queryParameters['terms'], '');
      expect(find.text('Удалить навсегда'), findsOneWidget);

      h.server.on('DELETE /api/me', const Reply(200, {'success': true}));
      await confirm(tester);
      final delete = h.server.to('DELETE /api/me').single;
      expect(delete.body, isEmpty);
      expect(delete.headers['X-CSRF-Token'], 'csrf-fresh');
      expect(h.session.user, isNull);
    });

    testWidgets('REAUTH_REQUIRED asks for Telegram again', (tester) async {
      await open(tester, {...telegramUser, 'requiresReauthentication': false});
      h.server.on('DELETE /api/me',
          const Reply(403, {'error': {'code': 'REAUTH_REQUIRED', 'message': 'Повторите вход через Telegram перед удалением аккаунта.'}}));
      await tapText(tester, 'Удалить аккаунт');
      await confirm(tester);

      expect(find.text('Срок подтверждения Telegram истёк. Подтвердите аккаунт ещё раз.'), findsOneWidget);
      expect(find.text('Подтвердить в Telegram'), findsOneWidget);
      expect(h.session.user?.requiresReauthentication, isTrue);
    });

    testWidgets('confirming in Telegram as another account cancels the deletion', (tester) async {
      await open(tester, telegramUser);
      h.web.answer = (_) async => 'otgolosok-auth://telegram?code=${'E' * 43}';
      h.server.on('POST /api/mobile-auth/exchange',
          const Reply(200, {'user': {'id': 'user-3', 'name': 'Пётр', 'authMethod': 'telegram', 'requiresReauthentication': false}, 'csrfToken': 'c'}));
      await tapText(tester, 'Удалить аккаунт');
      await confirm(tester);

      expect(h.server.to('DELETE /api/me'), isEmpty);
      expect(find.text('Пётр'), findsOneWidget);
      expect(find.text('Удалить аккаунт навсегда?'), findsNothing);
    });
  });

  testWidgets('sign-out clears the session and opens the map', (tester) async {
    await open(tester, passwordUser);
    h.server.on('POST /api/auth/sign-out', const Reply(200, {'success': true}));
    await tapText(tester, 'Выйти');
    expect(find.text('Подтвердите выход'), findsOneWidget);
    await confirm(tester);
    expect(h.server.to('POST /api/auth/sign-out'), hasLength(1));
    expect(h.session.user, isNull);
    expect(h.location, '/');
  });

  testWidgets('a failed section load shows its error with a retry', (tester) async {
    h.server.on('GET /api/me/favorites', const Reply(500, {'error': {'code': 'INTERNAL', 'message': 'boom'}}));
    await open(tester, passwordUser);
    await tapText(tester, 'Избранное');
    expect(find.text('Не удалось загрузить раздел.'), findsOneWidget);

    h.server.on('GET /api/me/favorites', const Reply(200, {
      'favorites': [
        {'type': 'walk', 'id': 'w', 'createdAt': '2026-10-01T10:00:00Z', 'title': 'Арбат', 'href': '/walk?catalog=arbat'},
      ],
      'nextCursor': null,
    }));
    await tapText(tester, 'Повторить загрузку');
    expect(find.text('Арбат'), findsOneWidget);
    await tapText(tester, 'Арбат');
    expect(h.opened, '/walk?catalog=arbat');
  });
}
