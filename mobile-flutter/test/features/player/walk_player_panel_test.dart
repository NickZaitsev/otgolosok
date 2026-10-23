import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/app/router.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/player/providers.dart';
import 'package:otgolosok/features/player/story_listen.dart';
import 'package:otgolosok/features/player/walk_player_panel.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../auth/harness.dart';
import '../walks/map_stand_in.dart';
import 'fake_host.dart';

class _App {
  final host = FakeHost();
  final map = WalkMapStandIn();
  final auth = Harness();
  late ProviderContainer container;
  late SettingsStore settings;

  int get launches => auth.server.to('POST /api/story-walks/arbat/launches').length;

  bool get walkActive => container.read(walkActiveProvider);

  Future<void> pump(WidgetTester tester, WalkView view, {WalkLink link = const CatalogWalkLink('arbat')}) async {
    tester.view.physicalSize = const Size(900, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    // The launch report carries the guest review key from the secure storage.
    FlutterSecureStorage.setMockInitialValues({});
    settings = SettingsStore(await SharedPreferences.getInstance());
    auth.server.on('POST /api/story-walks/arbat/launches', const Reply(200, {'counted': true}));
    final translations = loadTranslations();
    container = ProviderContainer(overrides: [
      apiProvider.overrideWithValue(auth.api),
      settingsProvider.overrideWithValue(settings),
      translationsProvider.overrideWithValue(translations),
      configProvider.overrideWithValue(auth.config),
      walkServiceHostApiProvider.overrideWithValue(host),
      map.override,
    ]);
    addTearDown(container.dispose);
    final router = GoRouter(initialLocation: '/walk', routes: [
      GoRoute(path: '/', builder: (context, state) => const Scaffold(body: Text('map'))),
      GoRoute(
        path: '/walk',
        builder: (context, state) => Scaffold(
          body: Column(children: [
            Expanded(child: WalkPlayerPanel(view: view, link: link)),
            StoryListenButton(id: 'osm:node:1', audio: Uri.parse('https://otgolosok.online/story.mp3'), title: 'Дом Нирнзее'),
          ]),
        ),
      ),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => Consumer(
          builder: (context, ref, _) => I18n(translations: translations, locale: ref.watch(localeProvider), child: child!),
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  Future<void> startWalk(WidgetTester tester) async {
    await tester.tap(find.text('Начать прогулку'));
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets('without location the explainer still starts the walk, in manual mode', (tester) async {
    final app = _App();
    app.host.permissions = ws.PermissionState(
      location: ws.PermissionStatus.permanentlyDenied,
      notifications: ws.PermissionStatus.granted,
      preciseLocation: false,
    );
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    expect(find.text('Разрешения для прогулки'), findsOneWidget);
    expect(find.text('Открыть настройки'), findsOneWidget);
    await tester.tap(find.text('Начать без геолокации'));
    await tester.pumpAndSettle();
    expect(app.host.sessions.single.kind, ws.SessionKind.walk);
    expect(find.text('Нет доступа к геолокации · звук доступен по кнопке'), findsOneWidget);
    expect(find.text('Геопозиции нет'), findsOneWidget);
    expect(app.walkActive, isTrue);
    expect(app.launches, 1);

    // The position help leads to the phone settings.
    await tester.tap(find.text('Геопозиции нет'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Проверить снова'));
    await tester.pumpAndSettle();
    expect(app.host.calls, contains('openAppSettings'));
  });

  testWidgets('«Не сейчас» in the explainer does not start anything', (tester) async {
    final app = _App();
    app.host.permissions = ws.PermissionState(
      location: ws.PermissionStatus.denied,
      notifications: ws.PermissionStatus.denied,
      preciseLocation: false,
    );
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    await tester.tap(find.text('Не сейчас'));
    await tester.pumpAndSettle();
    expect(app.host.sessions, isEmpty);
    expect(app.walkActive, isFalse);
  });

  testWidgets('allowed notifications are not asked about; blocked ones show a hint during the walk', (tester) async {
    final app = _App();
    app.host.permissions = ws.PermissionState(
      location: ws.PermissionStatus.denied,
      notifications: ws.PermissionStatus.denied,
      preciseLocation: false,
    );
    app.host.granted = ws.PermissionState(
      location: ws.PermissionStatus.granted,
      notifications: ws.PermissionStatus.permanentlyDenied,
      preciseLocation: true,
    );
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    await tester.tap(find.text('Разрешить'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isTrue);
    expect(find.text('Ищем сигнал GPS…'), findsOneWidget);
    expect(
      find.text('Уведомления выключены: управлять прогулкой с экрана блокировки не получится. Включите их в настройках телефона.'),
      findsOneWidget,
    );
  });

  testWidgets('a new interface language stops the walk; it continues from the saved place', (tester) async {
    final app = _App();
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    expect(app.walkActive, isTrue);
    await tester.tap(find.text('Дальше'));
    await tester.pumpAndSettle();
    expect(find.text('Дом 2'), findsOneWidget);

    await app.container.read(localeProvider.notifier).choose(AppLocale.en);
    await tester.pumpAndSettle();
    expect(app.host.count('stopSession'), 1);
    expect(app.walkActive, isFalse);
    expect(find.text('Continue walk'), findsOneWidget);

    await tester.tap(find.text('Continue walk'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isTrue);
    expect(find.text('Дом 2'), findsOneWidget);
    // The new session speaks the new language on the lock screen.
    expect(app.host.sessions.last.texts.nextAction, 'Next');
  });

  testWidgets('a story asks before it interrupts the walk', (tester) async {
    final app = _App();
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    await tester.tap(find.text('Слушать историю').last);
    await tester.pumpAndSettle();
    expect(find.text('Прервать прогулку?'), findsOneWidget);
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isTrue);
    expect(app.host.sessions, hasLength(1));

    await tester.tap(find.text('Слушать историю').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Прервать'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isFalse);
    expect(app.host.sessions.last.kind, ws.SessionKind.listen);
    expect(app.host.tracks.last.title, 'Дом Нирнзее');
  });

  testWidgets('the cross asks before it interrupts the walk', (tester) async {
    final app = _App();
    await app.pump(tester, walkView());
    await app.startWalk(tester);
    await tester.tap(find.byTooltip('Прервать прогулку'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isTrue);
    await tester.tap(find.byTooltip('Прервать прогулку'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Прервать'));
    await tester.pumpAndSettle();
    expect(app.walkActive, isFalse);
    expect(app.host.count('stopSession'), 1);
    expect(find.text('Продолжить прогулку'), findsOneWidget);
  });

  testWidgets('a car walk plays its story only after parking', (tester) async {
    final app = _App();
    await app.pump(tester, carView(), link: const LocalWalkLink('7d3c6c1e-6a0e-4b8e-9c55-8a1f0c7a2b11'));
    await tester.tap(find.text('Начать поездку'));
    await tester.pumpAndSettle();
    expect(find.text('Городская парковка'), findsOneWidget);
    expect(find.text('В дороге звук остановлен'), findsOneWidget);
    expect(app.walkActive, isTrue);
    await tester.tap(find.text('Я припарковался / Начать прогулку'));
    await tester.pumpAndSettle();
    expect(find.text('Дом 1'), findsOneWidget);
    await tester.tap(find.text('Слушать историю').first);
    await tester.pumpAndSettle();
    expect(app.host.sessions.single.tracking, isFalse);
    expect(app.host.tracks.single.id, audioOf('a'));
    await tester.tap(find.text('Вернуться к машине'));
    await tester.pumpAndSettle();
    expect(find.text('Машина ждёт на парковке'), findsWidgets);
    expect(app.host.count('stopSession'), 1);
  });
}
