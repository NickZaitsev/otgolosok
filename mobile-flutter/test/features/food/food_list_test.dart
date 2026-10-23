import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/food/food_list.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/opening_hours.dart';
import 'package:otgolosok/features/food/route_proximity.dart';

import '../auth/harness.dart' show loadTranslations;

const _manifest = FoodManifest(sourceEditedAt: '2026-10-01T00:00:00Z', attribution: '© OpenStreetMap contributors', cells: {});

RouteFoodPlace _place(String id, String name, double alongM) => RouteFoodPlace(
      FoodPlace(id: id, kind: FoodKind.cafe, name: name, lat: 55.776, lon: 37.612 + alongM / 100000),
      RouteMatch(distanceM: 40, alongM: alongM, vertex: 0),
    );

final _early = _place('osm:node:1', 'Кафе у начала', 50);
final _late = _place('osm:node:2', 'Кафе у конца', 900);

Future<void> _pump(
  WidgetTester tester, {
  List<RouteFoodPlace>? places,
  bool active = false,
  double fromM = 0,
  RouteFoodPlace? selected,
  FoodAdding? adding,
  bool error = false,
  bool loading = false,
  ValueChanged<RouteFoodPlace>? onSelect,
}) async {
  final translations = loadTranslations();
  await tester.pumpWidget(MaterialApp(
    locale: const Locale('ru'),
    supportedLocales: const [Locale('ru')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    builder: (context, child) => I18n(translations: translations, locale: AppLocale.ru, child: child!),
    home: Scaffold(
      body: WalkFoodList(
        places: places ?? [_early, _late],
        stops: const [0, 1000],
        active: active,
        fromM: fromM,
        selected: selected,
        onSelect: onSelect ?? (_) {},
        onBack: () {},
        onClose: () {},
        manifest: _manifest,
        hours: FoodHoursCache(),
        error: error,
        loading: loading,
        onRetry: () {},
        adding: adding,
      ),
    ),
  ));
}

FoodAdding _adding({Set<String> added = const {}, String? pending, String status = '', void Function(RouteFoodPlace)? onAdd}) => FoodAdding(
      isAdded: (place) => added.contains(place.id),
      onAdd: onAdd ?? (_) {},
      pending: pending,
      status: status,
    );

void main() {
  testWidgets('before the start the places are grouped by their nearest stop', (tester) async {
    await _pump(tester);
    expect(find.text('У остановки 1'), findsOneWidget);
    expect(find.text('У остановки 2'), findsOneWidget);
    expect(find.text('Кафе у начала'), findsOneWidget);
    expect(find.text('Кафе у конца'), findsOneWidget);
    expect(find.textContaining('© OpenStreetMap contributors'), findsOneWidget);
  });

  testWidgets('during the walk the places behind fold away and cannot join the walk', (tester) async {
    await _pump(tester, active: true, fromM: 500, adding: _adding());
    expect(find.text('Впереди'), findsOneWidget);
    expect(find.text('Позади · 1'), findsOneWidget);
    expect(find.text('Кафе у начала'), findsNothing);
    expect(find.byTooltip('Добавить «Кафе у конца» в прогулку'), findsOneWidget);

    await tester.tap(find.text('Позади · 1'));
    await tester.pumpAndSettle();
    expect(find.text('Кафе у начала'), findsOneWidget);
    expect(find.byTooltip('Добавить «Кафе у начала» в прогулку'), findsNothing);
  });

  testWidgets('one place at a time joins the walk; an added one is marked', (tester) async {
    await _pump(tester, adding: _adding(added: {_early.id}, pending: _late.id, status: '«Кафе у конца» добавлено в прогулку.'));
    expect(find.text('В прогулке'), findsOneWidget);
    expect(find.text('«Кафе у конца» добавлено в прогулку.'), findsOneWidget);
    final button = tester.widget<IconButton>(find.ancestor(of: find.byTooltip('Добавить «Кафе у конца» в прогулку'), matching: find.byType(IconButton)));
    expect(button.onPressed, isNull);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('the card of a chosen place adds it with its own button', (tester) async {
    final added = <String>[];
    await _pump(tester, selected: _late, adding: _adding(onAdd: (place) => added.add(place.id)));
    await tester.tap(find.text('Добавить в прогулку'));
    expect(added, [_late.id]);
  });

  testWidgets('without the add action the list only shows the places', (tester) async {
    final chosen = <String>[];
    await _pump(tester, onSelect: (place) => chosen.add(place.id));
    expect(find.byIcon(Icons.add_circle_outline), findsNothing);
    await tester.tap(find.text('Кафе у конца'));
    expect(chosen, [_late.id]);
  });

  group('the list says why it is empty', () {
    final cases = <String, (bool error, bool loading, String text)>{
      'a failed load offers a retry': (true, false, 'Не удалось загрузить заведения'),
      'a load in progress': (false, true, 'Загружаем заведения…'),
      'no places near the route': (false, false, 'В 150 м от маршрута заведений нет по данным OpenStreetMap'),
    };
    for (final MapEntry(key: name, value: (error, loading, text)) in cases.entries) {
      testWidgets(name, (tester) async {
        await _pump(tester, places: const [], error: error, loading: loading);
        expect(find.text(text), findsOneWidget);
      });
    }
  });
}
