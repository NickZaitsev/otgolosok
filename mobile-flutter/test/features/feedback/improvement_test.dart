import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/feedback/improvement_model.dart';
import 'package:otgolosok/features/feedback/improvement_sheet.dart';
import 'package:otgolosok/features/reviews/review_model.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/features/walks/walk_screen.dart';

import '../auth/harness.dart';
import '../walks/support.dart' show sampleView;
import '../walks/widget_harness.dart';

const _path = '/api/story-walks/arbat-test/improvements/mine';
const _open = {
  'mine': {
    'issues': ['short_text', 'voiceover'],
    'status': 'open',
    'updatedAt': '2026-10-02T10:00:00.000Z',
  },
};

void main() {
  group('validateImprovement', () {
    Map<String, Object?> mine(Map<String, Object?> changes) => {
          'mine': {'issues': ['no_images'], 'status': 'open', 'updatedAt': '2026-10-02T10:00:00.000Z', ...changes},
        };
    final table = <String, (Object?, List<ImprovementIssue>?, bool)>{
      'no request yet': ({'mine': null}, null, true),
      'an open request': (_open, [ImprovementIssue.shortText, ImprovementIssue.voiceover], true),
      'a resolved request': (mine({'status': 'resolved'}), [ImprovementIssue.noImages], true),
      'no «mine» field': (<String, Object?>{}, null, false),
      'an empty list of issues': (mine({'issues': <Object?>[]}), null, false),
      'an unknown issue': (mine({'issues': ['typos']}), null, false),
      'an unknown status': (mine({'status': 'closed'}), null, false),
      'no date': (mine({'updatedAt': null}), null, false),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () {
        if (value.$3) {
          expect(validateImprovement(value.$1)?.issues, value.$2);
        } else {
          expect(() => validateImprovement(value.$1), throwsFormatException);
        }
      });
    }
  });

  test('requests live beside the reviews of each kind of walk', () {
    expect(improvementPath(const CatalogReviewTarget('arbat-test')), _path);
    expect(improvementPath(const SharedReviewTarget('tok')), '/api/story-walks/shared/tok/improvements/mine');
    expect(improvementPath(const AccountReviewTarget('id-1')), '/api/me/walks/id-1/improvements/mine');
    expect(canonicalIssues({ImprovementIssue.voiceover, ImprovementIssue.shortText}), [ImprovementIssue.shortText, ImprovementIssue.voiceover]);
    expect(
      canonicalIssues([ImprovementIssue.voiceover, ImprovementIssue.noImages, ImprovementIssue.voiceover]),
      [ImprovementIssue.noImages, ImprovementIssue.voiceover],
    );
  });

  group('the sheet', () {
    late WalksHarness h;

    setUp(() {
      h = WalksHarness();
      h.server.on('GET /api/story-walks/arbat-test/view', Reply(200, sampleView()));
      h.server.on('GET /api/story-walks/arbat-test/reviews', const Reply(200, {
        'summary': {'average': null, 'count': 0},
        'reviews': <Object?>[],
        'nextCursor': null,
        'mine': null,
      }));
    });

    Future<void> openSheet(WidgetTester tester) async {
      await h.pump(tester, location: '/walk?catalog=arbat-test', screens: {
        '/walk': (state) => WalkScreen(link: WalkLink.parse(state.uri.queryParameters)!),
      });
      await tester.tap(find.byTooltip('Настройки прогулки'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Что улучшить в прогулке?'));
      await tester.pumpAndSettle();
    }

    Finder submit(String label) => find.widgetWithText(FilledButton, label);

    testWidgets('a first request needs a reason, is sent in canonical order and closes', (tester) async {
      h.server.on('GET $_path', const Reply(200, {'mine': null}));
      h.server.on('PUT $_path', const Reply(200, _open));
      await openSheet(tester);

      expect(tester.widget<FilledButton>(submit('Отправить')).onPressed, isNull);
      await tester.tap(find.text('Не нравится озвучка'));
      await tester.tap(find.text('Мало информации: тексты слишком короткие'));
      await tester.pump();
      await tester.tap(submit('Отправить'));
      await tester.pumpAndSettle();

      final sent = h.server.to('PUT $_path').single;
      expect(sent.body, {'issues': ['short_text', 'voiceover']});
      expect(sent.headers['X-Review-Key'], isA<String>());
      expect(find.text('Спасибо! Передали редакции — постараемся улучшить прогулку.'), findsOneWidget);
      await tester.pump(improvementSentClose);
      await tester.pumpAndSettle();
      expect(find.text('Не нравится озвучка'), findsNothing);
    });

    testWidgets('an open request can be withdrawn but not resent unchanged', (tester) async {
      h.server.on('GET $_path', const Reply(200, _open));
      h.server.on('PUT $_path', const Reply(200, {'mine': null}));
      await openSheet(tester);

      expect(find.text('Ваш запрос уже у редакции. Измените отметки или снимите все, чтобы отозвать его.'), findsOneWidget);
      expect(tester.widget<FilledButton>(submit('Сохранить изменения')).onPressed, isNull);

      await tester.tap(find.text('Не нравится озвучка'));
      await tester.tap(find.text('Мало информации: тексты слишком короткие'));
      await tester.pump();
      await tester.tap(submit('Отозвать запрос'));
      await tester.pumpAndSettle();

      expect(h.server.to('PUT $_path').single.body, {'issues': <Object?>[]});
      expect(find.text('Запрос отозван.'), findsOneWidget);
    });

    testWidgets('a form that failed to load can be retried and a failed send keeps the choice', (tester) async {
      h.server.on('GET $_path', const Reply(404, {'error': {'message': 'Не найдено.'}}));
      await openSheet(tester);
      expect(find.text('Не удалось загрузить форму.'), findsOneWidget);

      h.server.on('GET $_path', const Reply(200, {'mine': null}));
      h.server.on('PUT $_path', const Reply(422, {'error': {'code': 'INVALID', 'message': 'Запрос не прошёл проверку.'}}));
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Нет превью изображений'));
      await tester.pump();
      await tester.tap(submit('Отправить'));
      await tester.pumpAndSettle();

      expect(find.text('Запрос не прошёл проверку.'), findsOneWidget);
      expect(tester.widget<FilledButton>(submit('Повторить')).onPressed, isNotNull);
      expect(tester.widget<CheckboxListTile>(find.widgetWithText(CheckboxListTile, 'Нет превью изображений')).value, isTrue);
    });
  });
}
