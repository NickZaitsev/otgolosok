import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/app_container.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/core/api/api_client.dart';
import 'package:otgolosok/core/auth/session.dart';
import 'package:otgolosok/core/config.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/core/storage/pending_sign_out.dart';
import 'package:otgolosok/core/storage/review_key.dart';
import 'package:otgolosok/features/offline/offline_providers.dart';
import 'package:otgolosok/features/places/story_audio.dart';
import 'package:otgolosok/features/player/providers.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Start-up crashed with «UnimplementedError: apiProvider»: providers without overrides were
  // created in a parent scope that did not know the API client.
  test('services read at start-up resolve in the app container', () async {
    SharedPreferences.setMockInitialValues({});
    const secure = FlutterSecureStorage();
    final session = SessionStore(cookies: CookieJar(), reviewKeys: ReviewKeyStore(secure), pendingSignOut: PendingSignOutStore(secure));
    late final ProviderContainer app;
    final api = ApiClient(
      config: AppConfig.parse('https://otgolosok.online', dev: false),
      session: session,
      locale: () => app.read(localeProvider).name,
      dio: Dio(),
    );
    app = createAppContainer(
      settings: SettingsStore(await SharedPreferences.getInstance()),
      translations: const Translations({}),
      secure: secure,
      session: session,
      api: api,
    );
    addTearDown(app.dispose);

    expect(app.read(offlinePacksProvider), isNotNull);
    expect(app.read(walkServiceHubProvider), isNotNull);
    expect(app.read(localWalkStoreProvider), isNotNull);
    expect(app.read(storyAudioControllerProvider), same(app.read(storyListenControllerProvider)));
    expect(app.read(apiProvider), same(api));
  });
}
