import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/api/api_client.dart';
import '../core/auth/session.dart';
import '../core/i18n/translations.dart';
import '../core/settings/settings_store.dart';
import '../features/food/food_store.dart';
import '../features/offline/offline_food.dart';
import '../features/places/story_audio.dart';
import '../features/player/providers.dart';
import '../features/walk_builder/builder_storage.dart';
import '../features/walks/local_walks.dart';
import 'providers.dart';

/// The app-wide container. Every service from `main()` is overridden in this one root scope: a child
/// scope creates providers without overrides in its parent, where a service read would throw.
ProviderContainer createAppContainer({
  required SettingsStore settings,
  required Translations translations,
  required FlutterSecureStorage secure,
  required SessionStore session,
  required ApiClient api,
}) =>
    ProviderContainer(overrides: [
      settingsProvider.overrideWithValue(settings),
      translationsProvider.overrideWithValue(translations),
      secureStorageProvider.overrideWithValue(secure),
      sessionStoreProvider.overrideWithValue(session),
      apiProvider.overrideWithValue(api),
      // Guest walks: the builder writes them, the library and the walk screen read them.
      localWalkStoreProvider.overrideWith((ref) => ref.watch(deviceLocalWalkStoreProvider)),
      // Place stories play through the walk service, one recording at a time app-wide.
      storyAudioControllerProvider.overrideWith((ref) => ref.watch(storyListenControllerProvider)),
      // Offline copies keep the food along their route.
      offlineFoodSourceProvider.overrideWith((ref) => ref.watch(foodOfflineSourceProvider)),
    ]);
