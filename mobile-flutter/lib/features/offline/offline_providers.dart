import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../app/providers.dart';
import '../../core/auth/session.dart';
import '../../core/settings/settings_store.dart';
import 'offline_food.dart';
import 'offline_packs.dart';

/// The offline copies of this app, kept in the app files directory under `walk-packs/`.
final offlinePacksProvider = Provider<OfflinePackManager>((ref) {
  final api = ref.watch(apiProvider);
  final origin = ref.watch(configProvider).origin;
  return OfflinePackManager(
    root: () async => Directory('${(await getApplicationSupportDirectory()).path}/walk-packs'),
    download: (url, target, maxBytes) => api.download(origin.resolve(url), target, maxBytes: maxBytes),
    food: ref.watch(offlineFoodSourceProvider),
  );
});

const _lastUserKey = 'offline.lastUserId';

/// Who owns account copies: the signed-in user, or the last one while the session cannot be read
/// (an offline start), as the site's `getLastUserId`. Sign-out forgets it together with the copies.
String? offlineOwnerId(SessionStore session, SettingsStore settings) => session.user?.id ?? settings.readString(_lastUserKey);

/// Deletes the copies of account walks when their user signs out, remembers the signed-in user for
/// an offline start and clears what an interrupted save left behind. Call once at start-up.
void wireOfflinePacks(SessionStore session, OfflinePackManager packs, SettingsStore settings) {
  void remember() {
    final id = session.user?.id;
    if (id == null || settings.readString(_lastUserKey) == id) return;
    settings.writeString(_lastUserKey, id).catchError((Object error) => debugPrint('offline owner not saved: ${error.runtimeType}'));
  }

  session.addListener(remember);
  remember();
  session.onSignedOut((userId) async {
    if (settings.readString(_lastUserKey) == userId) await settings.remove(_lastUserKey);
    await packs.clearScope(userId);
  });
  unawaited(packs.cleanUp());
}
