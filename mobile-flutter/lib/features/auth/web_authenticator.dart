import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

import 'telegram_callback.dart';

/// The user closed the Custom Tab before the site sent the app back.
class WebAuthCancelled implements Exception {
  const WebAuthCancelled();
}

/// The Custom Tab could not be opened at all (no browser, plugin failure).
class WebAuthUnavailable implements Exception {
  const WebAuthUnavailable(this.code);

  final String code;

  @override
  String toString() => 'WebAuthUnavailable($code)';
}

/// Opens a site page in a Custom Tab and waits for the `otgolosok-auth://` callback.
abstract interface class WebAuthenticator {
  /// Returns the full callback URL; throws [WebAuthCancelled] or [WebAuthUnavailable].
  Future<String> authenticate(Uri url);
}

/// `flutter_web_auth_2` on Android: the callback activity for the scheme is declared in
/// `android/app/src/main/AndroidManifest.xml`.
class CustomTabAuthenticator implements WebAuthenticator {
  const CustomTabAuthenticator();

  @override
  Future<String> authenticate(Uri url) async {
    try {
      return await FlutterWebAuth2.authenticate(url: url.toString(), callbackUrlScheme: TelegramCallback.scheme);
    } on PlatformException catch (error) {
      if (error.code == 'CANCELED') throw const WebAuthCancelled();
      throw WebAuthUnavailable(error.code);
    }
  }
}

final webAuthenticatorProvider = Provider<WebAuthenticator>((ref) => const CustomTabAuthenticator());
