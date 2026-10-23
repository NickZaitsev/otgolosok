import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/account/my_walks_screen.dart';

import '../auth/harness.dart';
import 'fixtures.dart';

void main() {
  late Harness h;
  late List<String> copied;

  setUp(() {
    h = Harness();
    copied = [];
  });

  Future<void> open(WidgetTester tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    await h.signIn(passwordUser);
    await h.pump(tester, location: '/account/walks', screens: {'/account/walks': (_) => const MyWalksScreen()});
  }

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
    final public = tester.widget<RadioListTile<Object?>>(find.ancestor(of: find.text('Доступно всем'), matching: find.byWidgetPredicate((w) => w is RadioListTile)));
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
      'walks': [walkJson({'id': '223e4567-e89b-42d3-a456-426614174000', 'title': 'Арбат'})],
      'nextCursor': null,
    }));
    await tester.tap(find.text('Показать ещё'));
    await tester.pumpAndSettle();
    expect(h.server.sent.last.query, {'cursor': 'c2'});
    expect(find.text('Арбат'), findsOneWidget);
    expect(find.text('Показать ещё'), findsNothing);

    await tester.tap(find.text('Арбат'));
    await tester.pumpAndSettle();
    expect(h.opened, '/walk?id=223e4567-e89b-42d3-a456-426614174000');
  });
}
