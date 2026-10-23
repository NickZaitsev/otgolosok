import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/explore/parking_sheet.dart';
import 'package:otgolosok/features/food/food_card.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/opening_hours.dart';
import 'package:otgolosok/walk_engine/car_route.dart';
import 'package:otgolosok/walk_engine/distance.dart';

import '../auth/harness.dart' show loadTranslations;

const _manifest = FoodManifest(sourceEditedAt: '2026-09-30T22:30:00Z', attribution: '© OpenStreetMap contributors', cells: {});

const _full = FoodPlace(
  id: 'osm:node:1',
  kind: FoodKind.cafe,
  name: 'Кафе «Арбат»',
  lat: 55.75,
  lon: 37.6,
  address: 'Арбат, 1',
  openingHours: '24/7',
  cuisine: 'pizza;unknown_tag',
  website: 'https://example.ru',
  phone: '+7 495 000-00-00',
);

const _bare = FoodPlace(id: 'osm:node:2', kind: FoodKind.bar, name: 'Бар', lat: 55.75, lon: 37.6);

Future<void> _pump(WidgetTester tester, Widget child) async {
  final translations = loadTranslations();
  await tester.pumpWidget(MaterialApp(
    locale: const Locale('ru'),
    supportedLocales: const [Locale('ru')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    builder: (context, child) => I18n(translations: translations, locale: AppLocale.ru, child: child!),
    home: Scaffold(body: child),
  ));
}

void main() {
  testWidgets('a food place shows what the walker needs and the date of the data in Moscow', (tester) async {
    var closed = 0;
    await _pump(tester, FoodSheet(place: _full, manifest: _manifest, hours: FoodHoursCache(), distanceM: 118.6, onClose: () => closed++));

    expect(find.text('Кафе «Арбат»'), findsOneWidget);
    // An unknown cuisine tag never leaks into the UI.
    expect(find.text('Кафе · Пицца'), findsOneWidget);
    expect(find.text('≈ 119 м от вас'), findsOneWidget);
    expect(find.text('Открыто круглосуточно'), findsOneWidget);
    expect(find.text('Арбат, 1'), findsOneWidget);
    expect(find.text('Сайт'), findsOneWidget);
    expect(find.text('Позвонить'), findsOneWidget);
    // 22:30 UTC on 30 September is already 1 October in Moscow.
    expect(find.textContaining('Данные OpenStreetMap на 1 октября 2026'), findsOneWidget);
    expect(find.textContaining('© OpenStreetMap contributors'), findsOneWidget);

    await tester.tap(find.text('Часы работы по данным OpenStreetMap'));
    await tester.pumpAndSettle();
    expect(find.text('24/7'), findsOneWidget);

    await tester.tap(find.byTooltip('Закрыть карточку'));
    expect(closed, 1);
  });

  testWidgets('a place without details shows no empty links, hours or distance', (tester) async {
    await _pump(tester, FoodSheet(place: _bare, manifest: _manifest, hours: FoodHoursCache(), onClose: () {}));

    expect(find.text('Бар или паб'), findsOneWidget);
    expect(find.text('Часы не указаны'), findsOneWidget);
    expect(find.text('Часы работы по данным OpenStreetMap'), findsNothing);
    expect(find.textContaining('м от вас'), findsNothing);
    expect(find.text('Сайт'), findsNothing);
    expect(find.text('Позвонить'), findsNothing);
  });

  group('a parking card says', () {
    const cases = [
      (ParkingAccess.public, true, 'Общественная парковка', 'Платная парковка'),
      (ParkingAccess.unknown, false, 'Доступ на парковку не проверен. Перед поездкой убедитесь, что она открыта для всех.', 'Бесплатная парковка'),
      (ParkingAccess.public, null, 'Общественная парковка', 'Стоимость парковки неизвестна'),
    ];
    for (final (access, fee, accessText, feeText) in cases) {
      testWidgets('$feeText, ${access.wire}', (tester) async {
        const point = GeoPoint(55.75, 37.6);
        await _pump(
          tester,
          ParkingSheet(
            place: ParkingPlace(
              id: 'osm:way:3',
              name: 'Парковка у театра',
              location: point,
              entrance: point,
              exit: point,
              pedestrianAccess: point,
              access: access,
              fee: fee,
              openingHours: fee == true ? 'Mo-Fr 08:00-20:00' : null,
            ),
            attribution: '© OpenStreetMap contributors',
            onClose: () {},
          ),
        );
        expect(find.text('Парковка у театра'), findsOneWidget);
        expect(find.text(accessText), findsOneWidget);
        expect(find.text(feeText), findsOneWidget);
        expect(find.text('Часы работы: Mo-Fr 08:00-20:00'), fee == true ? findsOneWidget : findsNothing);
        expect(find.text('Доехать до парковки'), findsOneWidget);
        expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
      });
    }
  });
}
