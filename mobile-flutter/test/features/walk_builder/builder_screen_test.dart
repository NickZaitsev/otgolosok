import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/location/locate.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/explore/explore_providers.dart';
import 'package:otgolosok/features/walk_builder/builder_map.dart';
import 'package:otgolosok/features/walk_builder/builder_screen.dart';
import 'package:otgolosok/features/walk_builder/builder_storage.dart';
import 'package:otgolosok/features/walk_builder/parking.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/harness.dart';
import 'support.dart';

class _GrantedPermissions implements LocationPermissions {
  @override
  Future<LocationAccess> check() async => LocationAccess.granted;

  @override
  Future<LocationAccess> request() async => LocationAccess.granted;

  @override
  Future<void> openSettings() async {}
}

/// The device location switch; [opened] counts the visits to the system settings.
class _Services implements LocationServices {
  var on = true;
  var opened = 0;

  @override
  Future<bool> enabled() async => on;

  @override
  Future<void> openSettings() async => opened++;
}

class _Subscription implements FixSubscription {
  @override
  void cancel() {}
}

/// Records the plugin requests; fixes are never delivered.
class _Source implements FixSource {
  var listens = 0;

  @override
  FixSubscription listen(void Function(LocatedFix fix) onFix, void Function(LocateError error) onError) {
    listens++;
    return _Subscription();
  }
}

/// The builder at [location] over the harness API, with a plain stand-in for the map.
class _App {
  _App([Map<String, String>? stored]) : storage = MemoryBuilderStorage(stored);

  final harness = Harness();
  final MemoryBuilderStorage storage;
  final services = _Services();
  final source = _Source();
  BuilderMapProps? map;
  late GoRouter router;
  String? opened;

  Future<void> pump(WidgetTester tester, String location) async {
    tester.view.physicalSize = const Size(900, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final translations = loadTranslations();
    router = GoRouter(initialLocation: location, routes: [
      GoRoute(path: '/builder', builder: (context, state) => BuilderScreen(query: state.uri.queryParameters)),
      for (final path in ['/walk', '/login'])
        GoRoute(path: path, builder: (context, state) {
          opened = state.uri.toString();
          return Scaffold(body: Text('screen:$opened'));
        }),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiProvider.overrideWithValue(harness.api),
        sessionStoreProvider.overrideWithValue(harness.session),
        settingsProvider.overrideWithValue(SettingsStore(prefs)),
        translationsProvider.overrideWithValue(translations),
        configProvider.overrideWithValue(harness.config),
        builderStorageProvider.overrideWithValue(storage),
        parkingStorageProvider.overrideWithValue(MemoryCellStorage()),
        locationPermissionsProvider.overrideWithValue(_GrantedPermissions()),
        locationServicesProvider.overrideWithValue(services),
        locationFixSourceProvider.overrideWithValue(source),
        builderMapProvider.overrideWithValue((context, props) {
          map = props;
          return const ColoredBox(color: Colors.grey);
        }),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => I18n(translations: translations, locale: AppLocale.ru, child: child!),
      ),
    ));
    await tester.pumpAndSettle();
  }
}

void main() {
  _App app([Map<String, String>? stored]) {
    final result = _App(stored);
    result.harness.server.on('GET /api/auth/session', const Reply(200, {'user': null, 'csrfToken': 'csrf-1'}));
    return result;
  }

  testWidgets('a new walk starts with the start point to choose and no build button', (tester) async {
    final a = app();
    await a.pump(tester, '/builder');
    expect(find.text('Выберите начало'), findsOneWidget);
    expect(find.text('Пешком'), findsOneWidget);
    expect(find.text('Построить прогулку'), findsNothing);
    expect(a.map?.view.markers, isEmpty);
  });

  testWidgets('an address search sets the start, the time is chosen and research is offered when stories are few', (tester) async {
    final a = app();
    a.harness.server
      ..on('GET /api/story-place', Reply(200, placeJson(startPlace)))
      ..on('POST /api/walk-plan', const Reply(404, {'error': {'code': 'WALK_STOPS_NOT_FOUND', 'message': 'Рядом нет историй.'}}));
    await a.pump(tester, '/builder');

    await tester.tap(find.byKey(const ValueKey('endpoint-start')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ввести адрес'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('address-field')), 'Арбат 1');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('address-submit')));
    await tester.pumpAndSettle();
    expect(find.text(startPlace.address), findsOneWidget);
    expect(a.map?.view.markers.single.location, startPlace.location);

    await tester.tap(find.byKey(const ValueKey('endpoint-destination')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('По времени'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('minutes-60')));
    await tester.pumpAndSettle();
    expect(find.text('60 мин пешком · с возвращением'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('build-walk')));
    await tester.pumpAndSettle();
    expect(find.text('Рядом пока мало готовых историй.'), findsOneWidget);
    expect(find.text('Исследование района'), findsOneWidget);
    expect(find.text('Найти истории рядом'), findsOneWidget);
    expect((a.harness.server.to('POST /api/walk-plan').single.body! as Map<String, Object?>)['minutes'], 60);
  });

  testWidgets('«Моё местоположение» with location switched off offers the settings and a new check', (tester) async {
    final a = app()..services.on = false;
    await a.pump(tester, '/builder');
    await tester.tap(find.byKey(const ValueKey('endpoint-start')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Моё местоположение'));
    await tester.pumpAndSettle();

    expect(a.source.listens, 0);
    expect(find.textContaining('Проверьте, что геолокация включена в настройках устройства.'), findsOneWidget);
    await tester.tap(find.text('Включить геолокацию'));
    await tester.pumpAndSettle();
    expect(a.services.opened, 1);

    a.services.on = true;
    await tester.tap(find.text('Проверить снова'));
    await tester.pumpAndSettle();
    expect(a.source.listens, 1);
    expect(find.text('Включить геолокацию'), findsNothing);
  });

  testWidgets('a built walk opens its walk page', (tester) async {
    final a = app({BuilderKeys.draft: startDraft(route: fixturePlan(), stops: [fixturePlan().stops.single]).encode()});
    await a.pump(tester, '/builder?resume=1');
    await tester.tap(find.byKey(const ValueKey('open-walk')));
    await tester.pumpAndSettle();
    final localId = a.storage.values[BuilderKeys.activeLocal];
    expect(localId, isNotNull);
    expect(a.opened, '/walk?local=$localId');
    expect(a.storage.values[BuilderKeys.walks], contains(localId));
  });

  testWidgets('an unreadable draft is shown with its download and the form is not offered', (tester) async {
    final a = app({BuilderKeys.draft: '{broken'});
    await a.pump(tester, '/builder?resume=1');
    expect(find.byKey(const ValueKey('storage-error')), findsOneWidget);
    expect(find.text('Скачать черновик'), findsOneWidget);
    expect(find.text('Как передвигаемся'), findsNothing);
    expect(a.storage.values[BuilderKeys.draft], '{broken');
  });

  testWidgets('an account walk sends a guest to sign in and back', (tester) async {
    final a = app();
    await a.pump(tester, '/builder?id=$walkId');
    expect(a.opened, '/login?returnTo=${Uri.encodeQueryComponent('/builder?id=$walkId')}');
  });

  testWidgets('another builder link opens its own walk instead of the one on screen', (tester) async {
    final a = app({BuilderKeys.draft: startDraft().encode()});
    await a.pump(tester, '/builder?resume=1');
    expect(find.text(startPlace.address), findsOneWidget);

    a.router.go('/builder?id=$walkId&edit=1');
    await tester.pumpAndSettle();
    expect(a.opened, '/login?returnTo=${Uri.encodeQueryComponent('/builder?id=$walkId&edit=1')}');
  });

  testWidgets('a broken link is explained instead of opening the builder', (tester) async {
    final a = app();
    await a.pump(tester, '/builder?local=nope');
    expect(find.text('Локальная прогулка не найдена. Исходные данные сохранены.'), findsOneWidget);
    expect(a.harness.server.sent, isEmpty);
  });
}
