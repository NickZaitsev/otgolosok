import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// The PKCE pair of one Telegram sign-in (RFC 7636, method S256), as the site's
/// `src/features/auth/app-auth.ts` expects it: both values are 43 base64url characters.
///
/// The verifier lives only in memory for the duration of one sign-in and is never logged.
class Pkce {
  const Pkce._(this.verifier, this.challenge);

  /// 32 random bytes from [random] (a secure generator unless a test passes its own).
  factory Pkce.generate([Random? random]) {
    final source = random ?? Random.secure();
    final verifier = _base64Url(List<int>.generate(32, (_) => source.nextInt(256)));
    return Pkce._(verifier, challengeOf(verifier));
  }

  static final _value = RegExp(r'^[A-Za-z0-9_-]{43}$');

  final String verifier;
  final String challenge;

  /// `base64url(SHA-256(verifier))` without padding.
  static String challengeOf(String verifier) => _base64Url(sha256.convert(ascii.encode(verifier)).bytes);

  /// A challenge, verifier or handoff code: exactly 43 base64url characters.
  static bool isValue(String? value) => value != null && _value.hasMatch(value);

  static String _base64Url(List<int> bytes) => base64UrlEncode(bytes).replaceAll('=', '');

  @override
  String toString() => 'Pkce(***)';
}
