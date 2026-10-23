import 'dart:async';
import 'dart:ui';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'app/app.dart';
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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const secure = FlutterSecureStorage();
  final settings = await SettingsStore.open();
  final translations = await Translations.load(rootBundle);
  final cookies = PersistCookieJar(storage: SecureCookieStorage(secure));
  final session = SessionStore(cookies: cookies, reviewKeys: ReviewKeyStore(secure), pendingSignOut: PendingSignOutStore(secure));
  final container = ProviderContainer(overrides: [
    settingsProvider.overrideWithValue(settings),
    translationsProvider.overrideWithValue(translations),
    secureStorageProvider.overrideWithValue(secure),
    sessionStoreProvider.overrideWithValue(session),
  ]);
  final dio = Dio()..interceptors.add(AppCookieManager(cookies));
  final api = ApiClient(
    config: AppConfig.current,
    session: session,
    locale: () => container.read(localeProvider).name,
    dio: dio,
  );
  session.attach(api);
  final app = ProviderContainer(parent: container, overrides: [apiProvider.overrideWithValue(api)]);
  app.read(localeProvider.notifier).adoptDevice(AppLocale.fromDevice(PlatformDispatcher.instance.locales));
  unawaited(session.load());
  runApp(UncontrolledProviderScope(container: app, child: const OtgolosokApp()));
}
