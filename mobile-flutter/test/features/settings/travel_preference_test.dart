import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/features/settings/travel_preference.dart';

import '../auth/harness.dart';

void main() {
  testWidgets('the travel mode is walking by default and the choice is stored for new walks', (tester) async {
    final h = Harness();
    await h.pump(tester, location: '/settings', screens: {'/settings': (_) => const Scaffold(body: TravelPreference())});
    final settings = ProviderScope.containerOf(tester.element(find.byType(TravelPreference))).read(settingsProvider);
    expect(settings.prefersDriving, isFalse);

    await tester.tap(find.text('На машине'));
    await tester.pumpAndSettle();
    expect(settings.prefersDriving, isTrue);

    await tester.tap(find.text('Пешком'));
    await tester.pumpAndSettle();
    expect(settings.prefersDriving, isFalse);
  });
}
