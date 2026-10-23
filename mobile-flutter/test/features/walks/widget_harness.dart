import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/offline/offline_packs.dart';
import 'package:otgolosok/features/offline/offline_providers.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/harness.dart';

/// Guest walks kept in memory.
class MemoryLocalWalks implements LocalWalkStore {
  final walks = <String, LocalWalk>{};

  @override
  Future<LocalWalk?> get(String id) async => walks[id];

  @override
  Future<List<LocalWalk>> list() async => walks.values.toList();

  @override
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision}) async =>
      walks[document.id] = LocalWalk(document: document, revision: (expectedRevision ?? -1) + 1);
}

/// Offline copies in memory: widget tests run in a fake clock where file I/O never completes.
class MemoryPacks extends OfflinePackManager {
  MemoryPacks() : super(root: () async => throw UnimplementedError(), download: (url, target, maxBytes) async => throw UnimplementedError());

  final copies = <OfflineWalkRef, OfflineWalk>{};
  final saved = <OfflineWalkRef>[];
  Object? saveError;

  @override
  Future<OfflineWalk?> load(OfflineWalkRef ref, {bool seedFood = false}) async => copies[ref];

  @override
  Future<OfflineWalkManifest?> status(OfflineWalkRef ref) async => copies[ref]?.manifest;

  @override
  Future<Map<String, Uri>> localRecordings(WalkView view) async => const {};

  @override
  Future<OfflineSaveResult> save(Object? viewJson, OfflineWalkRef ref) async {
    final error = saveError;
    if (error != null) throw error;
    saved.add(ref);
    final view = WalkView.fromJson(viewJson);
    final manifest = manifestFor(ref, view);
    copies[ref] = OfflineWalk(view: view, json: viewJson, manifest: manifest, localAudio: const {});
    return OfflineSaveResult(manifest: manifest, foodWarning: false);
  }

  @override
  Future<void> remove(OfflineWalkRef ref) async => copies.remove(ref);

  /// Keeps [viewJson] as the copy of [ref], saved at [savedAt].
  void keep(OfflineWalkRef ref, Map<String, Object?> viewJson, {String savedAt = '2026-09-30T08:00:00.000Z'}) {
    final view = WalkView.fromJson(viewJson);
    copies[ref] = OfflineWalk(view: view, json: viewJson, manifest: manifestFor(ref, view, savedAt: savedAt), localAudio: const {});
  }

  static OfflineWalkManifest manifestFor(OfflineWalkRef ref, WalkView view, {String savedAt = '2026-10-01T12:00:00.000Z'}) =>
      OfflineWalkManifest(
        walkId: ref.walkId,
        scope: ref.scope,
        requestedLocale: ref.requestedLocale,
        revision: view.revision,
        contentVersion: view.contentVersion,
        savedAt: savedAt,
        audio: [
          for (final chapter in view.chapters)
            if (chapter.audio case final audio?) OfflineAudio(chapterId: chapter.id, url: audio.url, sha256: audio.sha256, bytes: 1),
        ],
      );
}

/// The walk screens over the auth [Harness] (real API client and session on a fake server), with
/// offline copies and guest walks in memory.
class WalksHarness {
  final auth = Harness();
  final local = MemoryLocalWalks();
  final packs = MemoryPacks();
  late SettingsStore settings;
  late GoRouter router;

  /// The last screen outside [screens] the app navigated to.
  String? opened;

  FakeServer get server => auth.server;

  String get location => router.routerDelegate.currentConfiguration.uri.toString();

  Future<void> pump(WidgetTester tester,
      {required String location, required Map<String, Widget Function(GoRouterState)> screens, AppLocale locale = AppLocale.ru}) async {
    tester.view.physicalSize = const Size(900, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    // Guest review keys live in secure storage; without the mock its channel never answers.
    FlutterSecureStorage.setMockInitialValues({});
    settings = SettingsStore(await SharedPreferences.getInstance());
    final translations = loadTranslations();
    router = GoRouter(initialLocation: location, routes: [
      for (final path in {'/', '/builder', '/walk', '/login', '/account', '/account/walks', '/history', ...screens.keys})
        GoRoute(
          path: path,
          builder: (context, state) {
            final screen = screens[path];
            if (screen != null) return screen(state);
            opened = state.uri.toString();
            return Scaffold(body: Text('screen:$opened'));
          },
        ),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiProvider.overrideWithValue(auth.api),
        sessionStoreProvider.overrideWithValue(auth.session),
        settingsProvider.overrideWithValue(settings),
        translationsProvider.overrideWithValue(translations),
        configProvider.overrideWithValue(auth.config),
        offlinePacksProvider.overrideWithValue(packs),
        localWalkStoreProvider.overrideWithValue(local),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => I18n(translations: translations, locale: locale, child: child!),
      ),
    ));
    await tester.pumpAndSettle();
  }
}
