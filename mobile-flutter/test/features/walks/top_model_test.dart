import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/walks/top_model.dart';

/// JSON equality with numbers compared by value (`2100` and `2100.0` are the same JSON number).
Object? _normalize(Object? value) => switch (value) {
      final num number => number.toDouble(),
      final Map<String, Object?> map => {for (final entry in map.entries) entry.key: _normalize(entry.value)},
      final List<Object?> list => [for (final item in list) _normalize(item)],
      _ => value,
    };

void main() {
  final cases = ((jsonDecode(File('test/fixtures/api/walk_cards.json').readAsStringSync()) as Map<String, Object?>)['top']! as List<Object?>)
      .cast<Map<String, Object?>>();

  group('validateTopWalkPage matches the site on the shared fixture', () {
    for (final item in cases) {
      final name = item['name']! as String;
      final input = item['input'];
      if (item['valid'] == true) {
        test(name, () {
          expect(_normalize(validateTopWalkPage(input).toJson()), _normalize(item['result']));
        });
      } else {
        test(name, () => expect(() => validateTopWalkPage(input), throwsA(anything)));
      }
    }
  });

  test('a further page that does not move forward is rejected', () {
    final page = {'walks': <Object?>[], 'total': 40, 'nextOffset': 20};
    expect(validateTopWalkPageAfter(0)(page).nextOffset, 20);
    expect(() => validateTopWalkPageAfter(20)(page), throwsFormatException);
  });

  group('topWalksQuery', () {
    final table = <String, (int, TopFilters, String, Map<String, String>)>{
      'Moscow first page without filters': (0, TopFilters.none, 'moscow', {}),
      'another city is named': (0, TopFilters.none, 'spb', {'city': 'spb'}),
      'offset only after the first page': (20, TopFilters.none, 'moscow', {'offset': '20'}),
      'metro start, «inside the circle» end and a bucket': (
        40,
        const TopFilters(start: 'Арбатская', end: insideCircle, duration: TopDuration.from31To60),
        'moscow',
        {'offset': '40', 'start': 'Арбатская', 'end': '@circle', 'duration': '31-to-60'},
      ),
      'every bucket has its wire value': (0, const TopFilters(duration: TopDuration.from61To90), 'moscow', {'duration': '61-to-90'}),
      'up to 30 minutes': (0, const TopFilters(duration: TopDuration.upTo30), 'moscow', {'duration': 'up-to-30'}),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () => expect(topWalksQuery(value.$1, value.$2, value.$3), value.$4));
    }
  });

  test('a further page does not repeat walks already shown', () {
    final page = validateTopWalkPage(cases.firstWhere((item) => item['name'] == 'no ratings yet')['input']);
    final merged = appendTopWalks(page.walks, page.walks);
    expect(merged.map((walk) => walk.key), page.walks.map((walk) => walk.key));
  });

  group('metro pickers', () {
    const arbatskaya = MetroOption(name: 'Арбатская', lines: [MetroLine(id: '3', name: 'Арбатско-Покровская', color: '#0072BA')], insideCircle: true);
    const sokol = MetroOption(name: 'Сокол', lines: [MetroLine(id: '2', name: 'Замоскворецкая', color: '#2DBE2C')]);

    test('«inside the circle» leads only when a station lies inside or it is chosen', () {
      expect(metroOptions(['Арбатская', 'Сокол'], '', [arbatskaya, sokol], label: 'Внутри', hint: 'Кольцо').first.name, insideCircle);
      expect(metroOptions(['Сокол'], '', [sokol], label: 'Внутри', hint: 'Кольцо').map((o) => o.name), ['Сокол']);
      expect(metroOptions(['Сокол'], insideCircle, [sokol], label: 'Внутри', hint: 'Кольцо').first.name, insideCircle);
      expect(metroOptions(['Новая'], '', const [], label: 'Внутри', hint: 'Кольцо').single.lines, isEmpty);
    });

    test('search ignores case and ё, ranks name prefixes first and keeps the server order', () {
      const options = [
        MetroOption(name: 'Новослободская', lines: []),
        MetroOption(name: 'Слободская', lines: []),
        MetroOption(name: 'Площадь Ильича', lines: [MetroLine(id: '8', name: 'Калининская', color: '#FFD702')]),
        MetroOption(name: 'Озёрная', lines: []),
      ];
      expect(searchMetroOptions(options, 'СЛОБ').map((o) => o.name), ['Слободская', 'Новослободская']);
      expect(searchMetroOptions(options, 'озер').map((o) => o.name), ['Озёрная']);
      expect(searchMetroOptions(options, 'ильича').map((o) => o.name), ['Площадь Ильича']);
      expect(searchMetroOptions(options, 'калинин').map((o) => o.name), ['Площадь Ильича']);
      expect(searchMetroOptions(options, '   ').length, options.length);
      expect(searchMetroOptions(options, 'xyz'), isEmpty);
    });
  });

  test('metro letters stay readable on light and dark lines', () {
    expect(metroTextIsBlack('#FFD702'), isTrue);
    expect(metroTextIsBlack('#0072BA'), isFalse);
  });

  group('card meta', () {
    String t(String source, Map<String, Object> values) =>
        values.entries.fold(source, (text, entry) => text.replaceAll('{${entry.key}}', '${entry.value}'));

    test('Russian story count uses the plural forms', () {
      expect(storyCountLabel(1, AppLocale.ru, t), '1 история');
      expect(storyCountLabel(3, AppLocale.ru, t), '3 истории');
      expect(storyCountLabel(11, AppLocale.ru, t), '11 историй');
      expect(storyCountLabel(21, AppLocale.ru, t), '21 история');
    });

    test('walking and car walks', () {
      final valid = validateTopWalkPage(cases.firstWhere((item) => item['name'] == 'car walk')['input']);
      final car = valid.walks.firstWhere((walk) => walk.driving);
      expect(formatTopWalkMeta(car, AppLocale.ru, t), startsWith('На машине · '));
      final walking = validateTopWalkPage(cases.firstWhere((item) => item['name'] == 'no ratings yet')['input']).walks.first;
      expect(formatTopWalkMeta(walking, AppLocale.ru, t), matches(RegExp(r'^\d+ мин · \d+,\d км · \d+ истори')));
    });
  });
}
