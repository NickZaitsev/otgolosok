import 'dart:convert';
import 'dart:ui';

import 'package:flutter/services.dart';

/// UI languages, as `src/lib/i18n/locale.ts`.
enum AppLocale {
  ru('ru-RU', 'Русский'),
  en('en', 'English'),
  zh('zh-CN', '简体中文');

  const AppLocale(this.tag, this.nativeName);

  final String tag;
  final String nativeName;

  Locale get flutterLocale => switch (this) {
        AppLocale.ru => const Locale('ru'),
        AppLocale.en => const Locale('en'),
        AppLocale.zh => const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
      };

  static AppLocale? parse(String? code) => AppLocale.values.where((locale) => locale.name == code).firstOrNull;

  /// The device language when nothing is stored: Russian for ru/uk/be/kk, Chinese for zh*, else English.
  static AppLocale fromDevice(List<Locale> preferred) {
    for (final locale in preferred) {
      final language = locale.languageCode.toLowerCase();
      if (const {'ru', 'uk', 'be', 'kk'}.contains(language)) return AppLocale.ru;
      if (language == 'zh') return AppLocale.zh;
      if (language == 'en') return AppLocale.en;
    }
    return AppLocale.en;
  }
}

/// `translate()` from `src/lib/i18n/translate.ts`: Russian source strings are the keys,
/// a missing entry falls back to Russian, `{name}` placeholders are filled from [values].
class Translations {
  const Translations(this._entries);

  /// Generated from the site dictionaries (src/lib/i18n/mobile-export.test.ts).
  static const siteAsset = 'assets/i18n/translations.json';

  /// Strings only the app shows (permissions, the walk service); same shape, edited by hand.
  static const appAsset = 'assets/i18n/app.json';
  static final _placeholder = RegExp(r'\{([a-zA-Z][a-zA-Z0-9_]*)\}');

  final Map<String, (String, String)> _entries;

  static Future<Translations> load(AssetBundle bundle) async =>
      merge([parse(await bundle.loadString(siteAsset)), parse(await bundle.loadString(appAsset))]);

  /// Validates one dictionary file; a malformed asset is a build defect and fails loudly.
  static Translations parse(String source) {
    final json = jsonDecode(source);
    if (json is! Map<String, Object?>) throw const FormatException('translations');
    final entries = <String, (String, String)>{};
    for (final MapEntry(:key, :value) in json.entries) {
      if (value is! List<Object?> || value.length != 2 || value[0] is! String || value[1] is! String) {
        throw FormatException('translations: $key');
      }
      entries[key] = (value[0]! as String, value[1]! as String);
    }
    return Translations(entries);
  }

  /// Like the site's `mergeTranslations`: the same source with different translations is an error.
  static Translations merge(List<Translations> dictionaries) {
    final merged = <String, (String, String)>{};
    for (final dictionary in dictionaries) {
      for (final MapEntry(:key, :value) in dictionary._entries.entries) {
        final previous = merged[key];
        if (previous != null && previous != value) throw StateError('Conflicting interface translation: $key');
        merged[key] = value;
      }
    }
    return Translations(merged);
  }

  Iterable<String> get sources => _entries.keys;

  bool has(String source) => _entries.containsKey(source);

  String translate(AppLocale locale, String source, [Map<String, Object> values = const {}]) {
    final entry = _entries[source];
    final text = locale == AppLocale.ru || entry == null ? source : (locale == AppLocale.en ? entry.$1 : entry.$2);
    if (!text.contains('{')) return text;
    return text.replaceAllMapped(_placeholder, (match) {
      final value = values[match[1]!];
      return value == null ? match[0]! : '$value';
    });
  }
}
