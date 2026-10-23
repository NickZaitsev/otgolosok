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

/// Whether the walk with this document id is walked from its end; the intro toggles it and the
/// player rebuilds with the new direction.
final walkReversedProvider = NotifierProvider.family<WalkReversedController, bool, String>(WalkReversedController.new);

class WalkReversedController extends Notifier<bool> {
  WalkReversedController(this.walkId);

  final String walkId;

  @override
  bool build() => ref.watch(settingsProvider).reversed(walkId);

  Future<void> set(bool reversed) async {
    await ref.read(settingsProvider).setReversed(walkId, reversed);
    state = reversed;
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
