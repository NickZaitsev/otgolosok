import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/reviews/review_sheet.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/features/walks/walk_screen.dart';

import '../auth/harness.dart';
import '../walks/support.dart' show sampleView;
import '../walks/widget_harness.dart';

const _reviews = 'GET /api/story-walks/arbat-test/reviews';
const _save = 'PUT /api/story-walks/arbat-test/reviews/mine';
const _empty = {
  'summary': {'average': null, 'count': 0},
  'reviews': <Object?>[],
  'nextCursor': null,
  'mine': null,
};

void main() {
  late WalksHarness h;

  setUp(() {
    h = WalksHarness();
    h.server.on('GET /api/story-walks/arbat-test/view', Reply(200, sampleView()));
  });

  Future<void> openForm(WidgetTester tester) async {
    await h.pump(tester, location: '/walk?catalog=arbat-test', screens: {
      '/walk': (state) => WalkScreen(link: WalkLink.parse(state.uri.queryParameters)!),
    });
    await tester.tap(find.text('Оставить отзыв'));
    await tester.pumpAndSettle();
  }

  Finder sendButton() => find.widgetWithText(FilledButton, 'Отправить отзыв');

  testWidgets('a guest review is sent only with stars and the sheet thanks and closes', (tester) async {
    h.server.on(_reviews, const Reply(200, _empty));
    h.server.on(_save, const Reply(200, {
      'summary': {'average': 4, 'count': 1},
      'mine': {'rating': 4, 'text': 'Хороший маршрут', 'status': 'published', 'updatedAt': '2026-10-02T10:00:00.000Z'},
    }));
    await openForm(tester);

    expect(find.text('Отзыв будет опубликован от имени «Гость». Изменить его можно только на этом устройстве.'), findsOneWidget);
    expect(tester.widget<FilledButton>(sendButton()).onPressed, isNull);

    await tester.tap(find.byTooltip('4 звезды из 5'));
    await tester.enterText(find.byType(TextField), '  Хороший маршрут  ');
    await tester.pump();
    await tester.tap(sendButton());
    await tester.pumpAndSettle();

    final sent = h.server.to(_save).single;
    expect(sent.body, {'rating': 4, 'text': 'Хороший маршрут'});
    expect(sent.headers['X-Review-Key'], isA<String>());
    expect(find.text('Спасибо! Оценка учтена.'), findsOneWidget);

    await tester.pump(reviewSentClose);
    await tester.pumpAndSettle();
    expect(find.text('Спасибо! Оценка учтена.'), findsNothing);
    // With a rating on the walk the button opens the reviews instead of an empty form.
    expect(find.text('Отзывы'), findsOneWidget);
  });

  testWidgets('a refused review keeps the form as a draft for the next opening', (tester) async {
    h.server.on(_reviews, const Reply(200, _empty));
    h.server.on(_save, const Reply(422, {'error': {'code': 'INVALID', 'message': 'Отзыв не прошёл проверку.'}}));
    await openForm(tester);

    await tester.tap(find.byTooltip('2 звезды из 5'));
    await tester.enterText(find.byType(TextField), 'Скучно');
    await tester.pump();
    await tester.tap(sendButton());
    await tester.pumpAndSettle();

    expect(find.text('Отзыв не прошёл проверку.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Повторить'), findsOneWidget);

    await tester.tap(find.byTooltip('Закрыть'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Оставить отзыв'));
    await tester.pumpAndSettle();
    expect(find.text('Скучно'), findsOneWidget);
  });

  testWidgets('reviews that fail to load leave the walk usable and can be retried', (tester) async {
    h.server.on(_reviews, const Reply(404, {'error': {'message': 'Не найдено.'}}));
    await openForm(tester);

    expect(find.text('Отзывы сейчас недоступны.'), findsOneWidget);
    h.server.on(_reviews, const Reply(200, _empty));
    await tester.tap(find.text('Повторить'));
    await tester.pumpAndSettle();
    expect(find.text('Отзывы сейчас недоступны.'), findsNothing);
    expect(sendButton(), findsOneWidget);
  });
}
