import 'package:flutter/widgets.dart';

import 'translations.dart';

/// Makes the dictionaries and the current UI language available to every widget.
class I18n extends InheritedWidget {
  const I18n({super.key, required this.translations, required this.locale, required super.child});

  final Translations translations;
  final AppLocale locale;

  static I18n of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<I18n>();
    assert(scope != null, 'I18n is missing above this widget');
    return scope!;
  }

  String t(String source, [Map<String, Object> values = const {}]) => translations.translate(locale, source, values);

  @override
  bool updateShouldNotify(I18n oldWidget) => oldWidget.locale != locale || oldWidget.translations != translations;
}

extension I18nContext on BuildContext {
  /// The UI string for a Russian source string, as `t()` on the site.
  String t(String source, [Map<String, Object> values = const {}]) => I18n.of(this).t(source, values);

  AppLocale get appLocale => I18n.of(this).locale;
}
