import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/places/place_sheet.dart';

import '../auth/harness.dart';

const _id = 'osm:way:1';
const _path = '/api/content/places/$_id';

/// The «valid russian» story of the site fixture, without its photo (tests load no network images).
({Map<String, Object?> input, Map<String, Object?> result}) _story() {
  final fixture = jsonDecode(File('test/fixtures/api/place_story.json').readAsStringSync()) as Map<String, Object?>;
  final item = (fixture['stories']! as List<Object?>).cast<Map<String, Object?>>().firstWhere((item) => item['name'] == 'valid russian');
  final input = item['input']! as Map<String, Object?>;
  (input['place']! as Map<String, Object?>).remove('photo');
  return (input: input, result: item['result']! as Map<String, Object?>);
}

/// The card in a host that expands and collapses it like the explore screen does.
class _Host extends StatefulWidget {
  const _Host({required this.onMissing, required this.onClose});

  final VoidCallback onMissing;
  final VoidCallback onClose;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  var expanded = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: PlaceStoryCard(
          key: const ValueKey(_id),
          placeId: _id,
          title: 'Дом из каталога',
          address: 'Адрес из каталога',
          expanded: expanded,
          onExpand: () => setState(() => expanded = true),
          onCollapse: () => setState(() => expanded = false),
          onClose: widget.onClose,
          onMissing: widget.onMissing,
        ),
      );
}

void main() {
  late Harness harness;
  late int missing;
  late int closed;
  final story = _story();
  final place = story.result['place']! as Map<String, Object?>;
  final paragraphs = (story.result['paragraphs']! as List<Object?>).cast<String>();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    harness = Harness();
    missing = 0;
    closed = 0;
  });

  /// Pumps one frame only: the story request is still running afterwards.
  Future<void> pumpCard(WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final translations = loadTranslations();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiProvider.overrideWithValue(harness.api),
        configProvider.overrideWithValue(harness.config),
        translationsProvider.overrideWithValue(translations),
      ],
      child: MaterialApp(
        builder: (context, child) => I18n(translations: translations, locale: AppLocale.ru, child: child!),
        home: _Host(onMissing: () => missing++, onClose: () => closed++),
      ),
    ));
  }

  testWidgets('the peek shows the first paragraph, the expanded card the whole story', (tester) async {
    harness.server.on('GET $_path', Reply(200, story.input));
    harness.server.on('GET $_path/feedback/mine', const Reply(200, {'mine': null}));
    await pumpCard(tester);
    expect(find.text('Загружаем рассказ…'), findsOneWidget);
    expect(find.text('Дом из каталога'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('Загружаем рассказ…'), findsNothing);
    expect(find.text(place['title']! as String), findsOneWidget);
    expect(find.text(paragraphs.first), findsOneWidget);
    expect(find.text(paragraphs.last), findsNothing);
    expect(find.text(place['address']! as String), findsNothing);
    expect(find.text('Поделиться'), findsNothing);

    await tester.tap(find.bySemanticsLabel('Читать историю полностью'));
    await tester.pumpAndSettle();
    for (final paragraph in paragraphs) {
      expect(find.text(paragraph), findsOneWidget);
    }
    expect(find.text(place['address']! as String), findsOneWidget);
    expect(find.textContaining('Портал открытых данных Правительства Москвы', findRichText: true), findsOneWidget);
    expect(find.text('Поделиться'), findsOneWidget);
    expect(find.text('Нравится'), findsOneWidget);
    // Reopening the card served the story from the cache: one request for the story in all.
    expect(harness.server.to('GET $_path'), hasLength(1));

    await tester.tap(find.bySemanticsLabel('Свернуть историю'));
    await tester.pumpAndSettle();
    expect(find.text(paragraphs.last), findsNothing);
  });

  testWidgets('a vote is saved for the place', (tester) async {
    harness.server.on('GET $_path', Reply(200, story.input));
    harness.server.on('GET $_path/feedback/mine', const Reply(200, {'mine': null}));
    harness.server.on('PUT $_path/feedback/mine', const Reply(200, {
      'mine': {'rating': 1, 'issues': <Object?>[], 'text': '', 'status': 'open', 'updatedAt': '2026-10-01T10:00:00.000Z'},
    }));
    await pumpCard(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Читать историю полностью'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Нравится'));
    await tester.pumpAndSettle();
    final put = harness.server.to('PUT $_path/feedback/mine').single;
    expect(put.body, {'rating': 1, 'issues': <Object?>[], 'text': ''});
    expect(put.headers['X-Review-Key'], isA<String>());
  });

  testWidgets('a failed load offers a retry that recovers', (tester) async {
    harness.server.on('GET $_path', const Reply(500, {'error': {'code': 'INTERNAL', 'message': 'Сбой'}}));
    await pumpCard(tester);
    await tester.pumpAndSettle();
    expect(find.text('Не удалось загрузить рассказ.'), findsOneWidget);
    expect(find.text(paragraphs.first), findsNothing);

    harness.server.on('GET $_path', Reply(200, story.input));
    await tester.tap(find.text('Повторить'));
    await tester.pump();
    expect(find.text('Загружаем рассказ…'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.text('Не удалось загрузить рассказ.'), findsNothing);
    expect(find.text(paragraphs.first), findsOneWidget);
    expect(missing, 0);
  });

  testWidgets('an unpublished story says so and asks the map to refresh', (tester) async {
    harness.server.on('GET $_path', const Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'Нет'}}));
    await pumpCard(tester);
    await tester.pumpAndSettle();
    expect(find.text('Эта история больше недоступна.'), findsOneWidget);
    expect(find.text('Повторить'), findsNothing);
    expect(missing, 1);

    await tester.tap(find.byTooltip('Закрыть карточку'));
    expect(closed, 1);
  });

  group('contentLanguageNote', () {
    final cases = <(AppLocale, AppLocale, bool, String?)>[
      (AppLocale.ru, AppLocale.ru, false, null),
      (AppLocale.en, AppLocale.ru, true, 'Текст и аудио этой истории пока доступны только на русском языке.'),
      (AppLocale.en, AppLocale.ru, false, 'Текст этой истории пока доступен только на русском языке. Озвучка готовится.'),
      (AppLocale.zh, AppLocale.zh, false, 'Озвучка этой истории на выбранном языке ещё готовится.'),
      (AppLocale.zh, AppLocale.zh, true, null),
    ];
    for (final (ui, content, audio, expected) in cases) {
      test('${ui.name} UI, ${content.name} content, audio $audio', () {
        expect(contentLanguageNote(ui, content, audioAvailable: audio), expected);
      });
    }
  });
}
