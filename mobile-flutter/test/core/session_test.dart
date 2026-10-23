import 'dart:convert';
import 'dart:typed_data';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_client.dart';
import 'package:otgolosok/core/api/app_cookie_manager.dart';
import 'package:otgolosok/core/auth/session.dart';
import 'package:otgolosok/core/config.dart';
import 'package:otgolosok/core/storage/pending_sign_out.dart';
import 'package:otgolosok/core/storage/review_key.dart';

/// Answers by path; `offline` turns every request into a connection error.
class _Server implements HttpClientAdapter {
  bool offline = false;
  int signOutStatus = 200;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    if (offline) throw DioException(requestOptions: options, type: DioExceptionType.connectionError);
    if (options.path == '/api/auth/sign-out') {
      return ResponseBody.fromString('{"success":true}', signOutStatus, headers: {
        'set-cookie': ['session=; Max-Age=0; Path=/'],
      });
    }
    return ResponseBody.fromString(jsonEncode({'user': null, 'csrfToken': null}), 200);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  final origin = Uri.parse('https://otgolosok.online');
  late _Server server;
  late CookieJar jar;
  late PendingSignOutStore pending;
  late SessionStore session;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    server = _Server();
    jar = CookieJar();
    pending = PendingSignOutStore(const FlutterSecureStorage());
    session = SessionStore(cookies: jar, reviewKeys: ReviewKeyStore(const FlutterSecureStorage()), pendingSignOut: pending);
    final api = ApiClient(
      config: AppConfig.parse(origin.toString(), dev: false),
      session: session,
      locale: () => 'ru',
      dio: Dio()
        ..httpClientAdapter = server
        ..interceptors.add(AppCookieManager(jar)),
      sleep: (_) async {},
    );
    session.attach(api);
    await jar.saveFromResponse(origin, [Cookie('session', 'old')]);
    await session.signedIn({'user': {'id': 'u1', 'name': 'Аня'}, 'csrfToken': 'csrf-old'});
  });

  test('online sign-out is confirmed and keeps nothing for later', () async {
    expect(await session.signOut(), isTrue);
    expect(await pending.read(), isEmpty);
    expect(await jar.loadForRequest(origin), isEmpty);
    expect(session.user, isNull);
  });

  test('offline sign-out clears the device and revokes the old session on a later start', () async {
    server.offline = true;
    expect(await session.signOut(), isFalse);
    expect(session.user, isNull);
    expect(await jar.loadForRequest(origin), isEmpty);
    expect(await pending.read(), ['session=old']);

    // Signed in again before the network came back: the new session must survive the revocation.
    await jar.saveFromResponse(origin, [Cookie('session', 'new')]);
    server
      ..offline = false
      ..requests.clear();
    await session.revokePending();

    final revoke = server.requests.singleWhere((r) => r.path == '/api/auth/sign-out');
    expect(revoke.headers['Cookie'], 'session=old');
    expect(revoke.headers.containsKey('X-CSRF-Token'), isFalse);
    expect(await pending.read(), isEmpty);
    expect((await jar.loadForRequest(origin)).single.value, 'new');
  });

  test('a revocation that is still offline stays queued; a rejected one is dropped', () async {
    server.offline = true;
    await session.signOut();
    await session.revokePending();
    expect(await pending.read(), ['session=old']);

    server
      ..offline = false
      ..signOutStatus = 400;
    await session.revokePending();
    expect(await pending.read(), isEmpty);
  });

  test('the queue keeps only the latest sessions', () async {
    for (var i = 0; i < PendingSignOutStore.limit + 2; i++) {
      await pending.add('session=$i');
    }
    expect(await pending.read(), [for (var i = 2; i < PendingSignOutStore.limit + 2; i++) 'session=$i']);
  });
}
