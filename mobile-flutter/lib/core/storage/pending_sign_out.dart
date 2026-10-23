import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Session cookies of sign-outs the server did not confirm (no network), revoked later like the
/// site's `OFFLINE_LOGOUT_KEY`. Kept in secure storage: each entry is a live credential.
class PendingSignOutStore {
  PendingSignOutStore(this._secure);

  static const _key = 'pending-sign-out:v1';

  /// Older entries are dropped beyond this; sessions expire on the server after 7 days anyway.
  static const limit = 5;

  final FlutterSecureStorage _secure;

  Future<List<String>> read() async {
    final raw = await _secure.read(key: _key);
    if (raw == null) return const [];
    try {
      final json = jsonDecode(raw);
      if (json is List<Object?>) return json.whereType<String>().where((cookie) => cookie.isNotEmpty).toList();
    } on FormatException {
      // A damaged entry cannot be revoked; it is replaced on the next write.
    }
    return const [];
  }

  Future<void> add(String cookieHeader) async {
    final entries = [...await read(), cookieHeader];
    await _write(entries.length > limit ? entries.sublist(entries.length - limit) : entries);
  }

  Future<void> remove(String cookieHeader) async => _write([...await read()]..remove(cookieHeader));

  Future<void> _write(List<String> entries) =>
      entries.isEmpty ? _secure.delete(key: _key) : _secure.write(key: _key, value: jsonEncode(entries));
}
