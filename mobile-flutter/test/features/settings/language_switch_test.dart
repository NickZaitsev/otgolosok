import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/app/router.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/settings/language_switch.dart';

import '../auth/harness.dart';

void main() {
  late Harness h;

  setUp(() => h = Harness());

  Future<ProviderContainer> open(WidgetTester tester, {required bool walking}) async {
    await h.pump(tester, location: '/settings', screens: {'/settings': (_) => const Scaffold(body: LanguageSwitch())});
    final container = ProviderScope.containerOf(tester.element(find.byType(LanguageSwitch)));
    container.read(walkActiveProvider.notifier).set(walking);
    return container;
  }

  Future<void> pick(WidgetTester tester, String language) async {
    await tester.tap(find.byType(LanguageSwitch));
    await tester.pumpAndSettle();
    await tester.tap(find.text(language).last);
    await tester.pumpAndSettle();
  }

  testWidgets('without a walk the language changes at once and is stored', (tester) async {
    final container = await open(tester, walking: false);
    await pick(tester, 'English');
    expect(find.text('Смена языка прервёт прогулку. Продолжить?'), findsNothing);
    expect(container.read(localeProvider), AppLocale.en);
    expect(container.read(settingsProvider).locale, AppLocale.en);
  });

  testWidgets('during a walk the change is confirmed first; cancel keeps the language', (tester) async {
    final container = await open(tester, walking: true);
    await pick(tester, '简体中文');
    expect(find.text('Смена языка прервёт прогулку. Продолжить?'), findsOneWidget);
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();
    expect(container.read(localeProvider), AppLocale.ru);
    expect(find.text('Русский'), findsOneWidget, reason: 'the field shows the kept language again');

    await pick(tester, '简体中文');
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();
    expect(container.read(localeProvider), AppLocale.zh);
  });
}
