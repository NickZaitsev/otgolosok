import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/i18n/i18n.dart';
import '../core/i18n/translations.dart';
import 'providers.dart';
import 'router.dart';
import 'theme/theme.dart';

class OtgolosokApp extends ConsumerWidget {
  const OtgolosokApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider);
    final translations = ref.watch(translationsProvider);
    return MaterialApp.router(
      title: 'Отголосок',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: ref.watch(routerProvider),
      locale: locale.flutterLocale,
      supportedLocales: [for (final value in AppLocale.values) value.flutterLocale],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (context, child) => I18n(translations: translations, locale: locale, child: child ?? const SizedBox.shrink()),
    );
  }
}
