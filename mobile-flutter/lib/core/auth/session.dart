import 'dart:async';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/api_error.dart';
import '../storage/review_key.dart';

/// The signed-in user as `/api/auth/session` returns it (backend/auth.mjs `publicAccountUser`).
@immutable
class AuthUser {
  const AuthUser({required this.id, required this.name, this.email, this.telegram = false, this.requiresReauthentication = false});

  static AuthUser? fromJson(Object? json) {
    if (json == null) return null;
    if (json is! Map<String, Object?>) throw const FormatException('user');
    final id = json['id'], name = json['name'], email = json['email'], method = json['authMethod'], reauth = json['requiresReauthentication'];
    if (id is! String || id.isEmpty || name is! String || (email != null && email is! String)) throw const FormatException('user');
    if (method != null && method != 'telegram') throw const FormatException('user');
    if (reauth != null && reauth is! bool) throw const FormatException('user');
    return AuthUser(id: id, name: name, email: email as String?, telegram: method == 'telegram', requiresReauthentication: reauth == true);
  }

  final String id;
  final String name;

  /// Null for Telegram accounts, whose stored address is a reserved placeholder.
  final String? email;
  final bool telegram;

  /// A Telegram account must sign in again before it may be deleted.
  final bool requiresReauthentication;

  AuthUser copyWith({String? name}) =>
      AuthUser(id: id, name: name ?? this.name, email: email, telegram: telegram, requiresReauthentication: requiresReauthentication);
}

/// `{user, csrfToken}` from `/api/auth/session` and `/api/mobile-auth/exchange`.
({AuthUser? user, String? csrfToken}) parseSession(Object? json) {
  if (json is! Map<String, Object?>) throw const FormatException('session');
  final token = json['csrfToken'];
  if (token != null && (token is! String || token.isEmpty)) throw const FormatException('csrfToken');
  final user = AuthUser.fromJson(json['user']);
  return (user: user, csrfToken: user == null ? null : token as String?);
}

/// The app's sign-in state: the cookie jar holds the session, this holds the user and CSRF token.
///
/// A 401 from `/api/me*` clears the state once (no refresh loop); sign-out clears the jar and
/// runs [onSignedOut] callbacks (offline copies of account walks are deleted there).
class SessionStore extends ChangeNotifier implements ApiSession {
  SessionStore({required this._cookies, required this._reviewKeys});

  final CookieJar _cookies;
  final ReviewKeyStore _reviewKeys;
  late final ApiClient _api;
  final _signedOut = <Future<void> Function(String userId)>[];

  AuthUser? _user;
  String? _csrf;
  bool _known = false;
  Future<String?>? _refreshing;

  AuthUser? get user => _user;

  /// False until the first `/api/auth/session` answer (or its failure).
  bool get known => _known;

  @override
  String? get csrfToken => _csrf;

  void attach(ApiClient api) => _api = api;

  /// Registers cleanup that must run whenever an account signs out.
  void onSignedOut(Future<void> Function(String userId) callback) => _signedOut.add(callback);

  /// Reads the session from the server; on failure the app starts as a guest and the next
  /// account request retries (offline start must never block the walk screens).
  Future<void> load() async {
    try {
      await refreshCsrf();
    } on ApiError catch (error) {
      debugPrint('session: ${error.code ?? error.status}');
    } finally {
      if (!_known) {
        _known = true;
        notifyListeners();
      }
    }
  }

  @override
  Future<String?> refreshCsrf() => _refreshing ??= _readSession().whenComplete(() => _refreshing = null);

  Future<String?> _readSession() async {
    final session = await _api.get('/api/auth/session', parseSession);
    await _apply(session.user, session.csrfToken);
    return _csrf;
  }

  /// Applies `{user, csrfToken}` returned by a sign-in that already set the cookie.
  Future<void> signedIn(Object? json) async {
    final session = parseSession(json);
    if (session.user == null) throw const ApiError.corrupt();
    await _apply(session.user, session.csrfToken);
  }

  /// Updates the cached profile after `PATCH /api/me`.
  void updateUser(AuthUser user) {
    _user = user;
    notifyListeners();
  }

  @override
  void onUnauthorized() {
    if (_user == null && _csrf == null) return;
    unawaited(_clear(_user?.id));
  }

  /// Best-effort server sign-out; the local session is always cleared.
  Future<void> signOut() async {
    try {
      await _api.send('POST', '/api/auth/sign-out', (_) {}, body: const <String, Object?>{});
    } on ApiError catch (error) {
      debugPrint('sign-out: ${error.code ?? error.status}');
    }
    await _clear(_user?.id);
  }

  /// The account no longer exists (`DELETE /api/me` succeeded).
  Future<void> accountDeleted() => _clear(_user?.id);

  @override
  Future<String> guestReviewKey() => _reviewKeys.read();

  Future<void> _apply(AuthUser? user, String? csrf) async {
    final previous = _user?.id;
    if (previous != null && previous != user?.id) await _runSignedOut(previous);
    _user = user;
    _csrf = csrf;
    _known = true;
    notifyListeners();
  }

  Future<void> _clear(String? userId) async {
    _user = null;
    _csrf = null;
    _known = true;
    await _cookies.deleteAll();
    notifyListeners();
    if (userId != null) await _runSignedOut(userId);
  }

  Future<void> _runSignedOut(String userId) async {
    for (final callback in _signedOut) {
      try {
        await callback(userId);
      } catch (error) {
        debugPrint('sign-out cleanup failed: $error');
      }
    }
  }
}
