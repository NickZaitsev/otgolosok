import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The guest device key for reviews and feedback (`X-Review-Key`), like the site's
/// `otgolosok:review-key:v1`: 32 random bytes as 43 base64url characters, created once.
class ReviewKeyStore {
  ReviewKeyStore(this._secure, {Random? random}) : _random = random ?? Random.secure();

  static const _key = 'review-key:v1';
  static final _valid = RegExp(r'^[A-Za-z0-9_-]{43}$');

  final FlutterSecureStorage _secure;
  final Random _random;
  Future<String>? _pending;

  Future<String> read() => _pending ??= _readOrCreate().whenComplete(() => _pending = null);

  Future<String> _readOrCreate() async {
    final existing = await _secure.read(key: _key);
    if (existing != null && _valid.hasMatch(existing)) return existing;
    final key = base64UrlEncode(List<int>.generate(32, (_) => _random.nextInt(256))).replaceAll('=', '');
    await _secure.write(key: _key, value: key);
    return key;
  }
}
