import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';

void main() {
  final site = Translations.parse(File('assets/i18n/translations.json').readAsStringSync());
  final app = Translations.merge([
    for (final file in Directory('assets/i18n/app').listSync().whereType<File>().where((f) => f.path.endsWith('.json')))
      Translations.parse(file.readAsStringSync()),
  ]);
  final all = Translations.merge([site, app]);

  test('translate falls back to Russian and fills placeholders like the site', () {
    const t = Translations({'Привет, {name}': ('Hello, {name}', '你好，{name}')});
    expect(t.translate(AppLocale.en, 'Привет, {name}', {'name': 'Аня'}), 'Hello, Аня');
    expect(t.translate(AppLocale.zh, 'Привет, {name}', {'name': 'Аня'}), '你好，Аня');
    expect(t.translate(AppLocale.ru, 'Привет, {name}', {'name': 3}), 'Привет, 3');
    expect(t.translate(AppLocale.en, 'Привет, {name}'), 'Hello, {name}');
    expect(t.translate(AppLocale.en, 'Нет перевода {n}', {'n': 1}), 'Нет перевода 1');
  });

  test('merge rejects the same source with different translations', () {
    expect(() => Translations.merge([const Translations({'А': ('a', 'b')}), const Translations({'А': ('a', 'c')})]), throwsStateError);
  });

  test('malformed dictionaries fail loudly', () {
    expect(() => Translations.parse('{"А": ["a"]}'), throwsFormatException);
    expect(() => Translations.parse('[]'), throwsFormatException);
  });

  test('every string the app passes to t() has a translation', () {
    final call = RegExp(r"""\.t\(\s*'((?:[^'\\]|\\.)*)'""");
    final missing = <String>{};
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
      for (final match in call.allMatches(file.readAsStringSync())) {
        final source = match[1]!.replaceAll(r"\'", "'");
        if (!all.has(source)) missing.add('${file.path}: $source');
      }
    }
    expect(missing, isEmpty);
  });

  test('app strings keep the placeholders of their Russian source', () {
    final placeholder = RegExp(r'\{[a-zA-Z][a-zA-Z0-9_]*\}');
    Set<String> names(String text) => placeholder.allMatches(text).map((m) => m[0]!).toSet();
    for (final source in app.sources) {
      for (final locale in [AppLocale.en, AppLocale.zh]) {
        expect(names(app.translate(locale, source)), names(source), reason: source);
      }
    }
  });

  group('AppLocale.fromDevice', () {
    final cases = {
      'ru': AppLocale.ru, 'uk': AppLocale.ru, 'be': AppLocale.ru, 'kk': AppLocale.ru,
      'zh': AppLocale.zh, 'en': AppLocale.en, 'de': AppLocale.en,
    };
    for (final MapEntry(:key, :value) in cases.entries) {
      test(key, () => expect(AppLocale.fromDevice([Locale(key)]), value));
    }
    test('first known language wins', () => expect(AppLocale.fromDevice(const [Locale('fr'), Locale('zh', 'TW')]), AppLocale.zh));
  });
}
