import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walks/library_screen.dart';

import '../auth/harness.dart';
import 'account_walk_fixtures.dart';
import 'widget_harness.dart';

/// «Мои прогулки» of the profile: the walk library in `mine` mode.
void main() {
  late WalksHarness h;
  late List<String> copied;

  setUp(() {
    h = WalksHarness();
    copied = [];
  });

  Future<void> open(WidgetTester tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments! as Map<Object?, Object?>)['text']! as String);
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    await h.auth.signIn(passwordUser);
    await h.pump(tester, location: '/account/walks', screens: {'/account/walks': (_) => const MyWalksScreen()});
  }

  testWidgets('the app bar names the screen; there is no top tab', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': null}));
    await open(tester);
    expect(find.descendant(of: find.byType(AppBar), matching: find.text('Мои прогулки')), findsOneWidget);
    expect(find.text('Мои прогулки'), findsOneWidget);
    expect(find.text('Топ прогулок'), findsNothing);
    expect(find.textContaining('60 мин пешком · 4,2 км'), findsOneWidget);
  });

  testWidgets('making a private walk public copies its link and mentions the review', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson({'visibility': 'private', 'shareToken': null})], 'nextCursor': null}));
    await open(tester);
    expect(find.text('Доступ: Только я'), findsOneWidget);
    expect(find.text('Скопировать ссылку'), findsNothing);

    h.server.on('PUT /api/me/walks/$walkId/sharing', Reply(200, {'walk': walkJson({'visibility': 'public', 'listingStatus': 'pending', 'revision': 4})}));
    await tester.tap(find.widgetWithText(TextButton, 'Доступ'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Доступно всем'));
    await tester.tap(find.byKey(const ValueKey('access-save')));
    await tester.pumpAndSettle();

    expect(h.server.to('PUT /api/me/walks/$walkId/sharing').single.body, {'revision': 3, 'visibility': 'public'});
    expect(copied, ['https://otgolosok.online/walk?share=$walkShareToken']);
    expect(find.text('Ссылка скопирована. Прогулка появится в топе после проверки.'), findsOneWidget);
    expect(find.text('Доступ: Всем · на проверке'), findsOneWidget);
  });

  testWidgets('a conflict from another device is explained in the sheet', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': null}));
    await open(tester);
    h.server.on('PUT /api/me/walks/$walkId/sharing', const Reply(409, {'error': {'code': 'CONFLICT', 'message': 'conflict'}}));
    await tester.tap(find.widgetWithText(TextButton, 'Доступ'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Только я'));
    await tester.tap(find.byKey(const ValueKey('access-save')));
    await tester.pumpAndSettle();
    expect(find.text('Прогулка изменилась на другом устройстве. Обновите страницу и повторите.'), findsOneWidget);
  });

  testWidgets('a draft cannot be made public', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson({'draft': true})], 'nextCursor': null}));
    await open(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Доступ'));
    await tester.pumpAndSettle();
    final public = tester.widget<RadioListTile<Object?>>(
      find.ancestor(of: find.text('Доступно всем'), matching: find.byWidgetPredicate((widget) => widget is RadioListTile)),
    );
    expect(public.enabled, isFalse);
  });

  testWidgets('a failed load offers a retry, then pages load with the cursor', (tester) async {
    h.server.on('GET /api/me/walks', const Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'x'}}));
    await open(tester);
    expect(find.text('Не удалось открыть прогулки.'), findsOneWidget);

    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': 'c2'}));
    await tester.tap(find.text('Повторить'));
    await tester.pumpAndSettle();
    expect(find.text('Замоскворечье'), findsOneWidget);

    h.server.on('GET /api/me/walks', Reply(200, {
      'walks': [walkJson({'id': '223e4567-e89b-42d3-a456-426614174000', 'title': 'Арбат', 'updatedAt': '2026-10-19T10:00:00.000Z'})],
      'nextCursor': null,
    }));
    await tester.tap(find.text('Показать ещё'));
    await tester.pumpAndSettle();
    expect(h.server.to('GET /api/me/walks').last.query, {'cursor': 'c2'});
    expect(find.text('Арбат'), findsOneWidget);
    expect(find.text('Показать ещё'), findsNothing);

    await tester.tap(find.text('Арбат'));
    await tester.pumpAndSettle();
    expect(h.opened, '/walk?id=223e4567-e89b-42d3-a456-426614174000');
  });

  testWidgets('pulling the list down reloads it without hiding the cards', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': null}));
    await open(tester);
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson({'title': 'Замоскворечье вечером'})], 'nextCursor': null}));
    // The screen is 2000 px tall: the pull must pass a quarter of it.
    await tester.fling(find.text('Замоскворечье'), const Offset(0, 1200), 1000);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1)); // the scroll settles
    expect(find.text('Замоскворечье'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1)); // the indicator settles
    await tester.pumpAndSettle();
    expect(h.server.to('GET /api/me/walks'), hasLength(2));
    expect(find.text('Замоскворечье вечером'), findsOneWidget);
  });

  testWidgets('«Редактировать» opens the account walk in the builder', (tester) async {
    h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': null}));
    await open(tester);
    await tester.tap(find.text('Редактировать'));
    await tester.pumpAndSettle();
    expect(h.opened, '/builder?id=$walkId&edit=1');
  });
}
