import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/api/api_client.dart';
import '../core/auth/session.dart';
import '../core/config.dart';
import '../core/i18n/translations.dart';
import '../core/settings/settings_store.dart';

/// Services created once in `main()` and injected with `ProviderScope.overrides`;
/// tests override them with fakes.
final configProvider = Provider<AppConfig>((ref) => AppConfig.current);
final settingsProvider = Provider<SettingsStore>((ref) => throw UnimplementedError('settingsProvider'));
final translationsProvider = Provider<Translations>((ref) => throw UnimplementedError('translationsProvider'));
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) => const FlutterSecureStorage());
final sessionStoreProvider = Provider<SessionStore>((ref) => throw UnimplementedError('sessionStoreProvider'));
final apiProvider = Provider<ApiClient>((ref) => throw UnimplementedError('apiProvider'));

/// The UI language: stored choice, else the device language.
final localeProvider = NotifierProvider<LocaleController, AppLocale>(LocaleController.new);

class LocaleController extends Notifier<AppLocale> {
  @override
  AppLocale build() => ref.watch(settingsProvider).locale ?? AppLocale.ru;

  /// Called once at start with the device languages when nothing is stored.
  void adoptDevice(AppLocale device) {
    if (ref.read(settingsProvider).locale == null) state = device;
  }

  Future<void> choose(AppLocale locale) async {
    await ref.read(settingsProvider).setLocale(locale);
    state = locale;
  }
}

/// The signed-in user; rebuilt whenever [SessionStore] changes.
final authUserProvider = NotifierProvider<AuthUserController, AuthUser?>(AuthUserController.new);

class AuthUserController extends Notifier<AuthUser?> {
  @override
  AuthUser? build() {
    final store = ref.watch(sessionStoreProvider);
    void listener() => state = store.user;
    store.addListener(listener);
    ref.onDispose(() => store.removeListener(listener));
    return store.user;
  }
}
