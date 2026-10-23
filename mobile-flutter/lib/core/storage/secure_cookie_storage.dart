import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// `cookie_jar` storage on `flutter_secure_storage` (Android Keystore), so the session cookie
/// never lands in plain app files. Keys are namespaced to delete them all on sign-out.
class SecureCookieStorage implements Storage {
  SecureCookieStorage(this._secure);

  static const _prefix = 'cookies:';

  final FlutterSecureStorage _secure;

  @override
  Future<void> init(bool persistSession, bool ignoreExpires) async {}

  @override
  Future<String?> read(String key) => _secure.read(key: '$_prefix$key');

  @override
  Future<void> write(String key, String value) => _secure.write(key: '$_prefix$key', value: value);

  @override
  Future<void> delete(String key) => _secure.delete(key: '$_prefix$key');

  @override
  Future<void> deleteAll(List<String> keys) async {
    for (final key in keys) {
      await delete(key);
    }
  }
}
