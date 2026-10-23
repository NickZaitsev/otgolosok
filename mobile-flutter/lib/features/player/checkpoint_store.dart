import 'dart:async';

import '../../core/settings/settings_store.dart';
import '../../walk_engine/walk_session.dart';

/// Resume checkpoints in the app's preferences, under the site's keys (`otgolosok:playback:…`).
/// Writes are chained so they apply in call order, as [CheckpointStore] requires.
class SettingsCheckpointStore implements CheckpointStore {
  SettingsCheckpointStore(this._settings);

  final SettingsStore _settings;
  Future<void> _tail = Future.value();

  @override
  String? read(String key) => _settings.readString(key);

  @override
  Future<void> write(String key, String value) => _chain(() => _settings.writeString(key, value));

  @override
  Future<void> remove(String key) => _chain(() => _settings.remove(key));

  Future<void> _chain(Future<Object?> Function() operation) {
    final next = _tail.then((_) => operation()).then<void>((_) {});
    // A failed write must not block the ones after it; the caller still sees its own error.
    _tail = next.catchError((Object _) {});
    return next;
  }
}
