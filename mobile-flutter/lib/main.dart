import 'dart:async';
import 'dart:ui';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'app/app.dart';
import 'app/app_container.dart';
import 'app/providers.dart';
import 'core/api/api_client.dart';
import 'core/api/app_cookie_manager.dart';
import 'core/auth/session.dart';
import 'core/config.dart';
import 'core/i18n/translations.dart';
import 'core/settings/settings_store.dart';
import 'core/storage/pending_sign_out.dart';
import 'core/storage/review_key.dart';
import 'core/storage/secure_cookie_storage.dart';
import 'features/offline/offline_providers.dart';
import 'features/player/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const secure = FlutterSecureStorage();
  final settings = await SettingsStore.open();
  final translations = await Translations.load(rootBundle);
  final cookies = PersistCookieJar(storage: SecureCookieStorage(secure));
  final session = SessionStore(cookies: cookies, reviewKeys: ReviewKeyStore(secure), pendingSignOut: PendingSignOutStore(secure));
  final dio = Dio()..interceptors.add(AppCookieManager(cookies));
  late final ProviderContainer app;
  final api = ApiClient(
    config: AppConfig.current,
    session: session,
    locale: () => app.read(localeProvider).name,
    dio: dio,
  );
  session.attach(api);
  app = createAppContainer(settings: settings, translations: translations, secure: secure, session: session, api: api);
  app.read(localeProvider.notifier).adoptDevice(AppLocale.fromDevice(PlatformDispatcher.instance.locales));
  // Remembers the account owning offline copies and deletes its private copies on sign-out.
  wireOfflinePacks(session, app.read(offlinePacksProvider), settings);
  // A service left running by a previous Dart instance has no owner here: stop it.
  unawaited(app.read(walkServiceHubProvider).reconcile());
  unawaited(session.load());
  runApp(UncontrolledProviderScope(container: app, child: const OtgolosokApp()));
}
