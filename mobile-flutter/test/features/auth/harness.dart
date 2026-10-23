import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:otgolosok/app/providers.dart';
import 'package:otgolosok/core/api/api_client.dart';
import 'package:otgolosok/core/auth/session.dart';
import 'package:otgolosok/core/config.dart';
import 'package:otgolosok/core/i18n/i18n.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/core/storage/pending_sign_out.dart';
import 'package:otgolosok/core/storage/review_key.dart';
import 'package:otgolosok/features/auth/web_authenticator.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A canned HTTP answer.
class Reply {
  const Reply(this.status, [this.body]);
  final int status;
  final Object? body;
}

/// A request the app sent: method, path, query and decoded JSON body.
class Sent {
  const Sent(this.method, this.path, this.query, this.body, this.headers);
  final String method;
  final String path;
  final Map<String, String> query;
  final Object? body;
  final Map<String, Object?> headers;

  @override
  String toString() => '$method $path';
}

/// Answers by `METHOD /path` with the reply set last; an unexpected request fails the test.
class FakeServer implements HttpClientAdapter {
  final _routes = <String, Reply>{};
  final sent = <Sent>[];

  void on(String route, Reply reply) => _routes[route] = reply;

  List<Sent> to(String route) => sent.where((request) => '${request.method} ${request.path}' == route).toList();

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final data = options.data;
    sent.add(Sent(options.method, options.uri.path, options.uri.queryParameters, data is String ? jsonDecode(data) : null, options.headers));
    final route = '${options.method} ${options.uri.path}';
    final reply = _routes[route];
    if (reply == null) throw StateError('unexpected request $route');
    final body = reply.body == null ? '' : jsonEncode(reply.body);
    return ResponseBody.fromString(body, reply.status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });
  }

  @override
  void close({bool force = false}) {}
}

/// Returns a prepared callback URL and remembers the page it was asked to open.
class FakeWebAuthenticator implements WebAuthenticator {
  final opened = <Uri>[];
  Future<String> Function(Uri url) answer = (_) async => throw const WebAuthCancelled();

  @override
  Future<String> authenticate(Uri url) {
    opened.add(url);
    return answer(url);
  }
}

const passwordUser = {'id': 'user-1', 'name': 'Анна Петрова', 'email': 'anna@example.com'};
const telegramUser = {'id': 'user-2', 'name': 'Иван', 'email': null, 'authMethod': 'telegram', 'requiresReauthentication': true};

Translations loadTranslations() => Translations.merge([
      Translations.parse(File('assets/i18n/translations.json').readAsStringSync()),
      for (final file in Directory('assets/i18n/app').listSync().whereType<File>().where((f) => f.path.endsWith('.json')))
        Translations.parse(file.readAsStringSync()),
    ]);

/// The real [ApiClient] and [SessionStore] over a [FakeServer], plus the app's providers.
class Harness {
  Harness() {
    session = SessionStore(
      cookies: CookieJar(),
      reviewKeys: ReviewKeyStore(const FlutterSecureStorage()),
      pendingSignOut: PendingSignOutStore(const FlutterSecureStorage()),
    );
    api = ApiClient(
      config: config,
      session: session,
      locale: () => 'ru',
      dio: Dio()..httpClientAdapter = server,
      sleep: (_) async {},
    );
    session.attach(api);
  }

  final server = FakeServer();
  final web = FakeWebAuthenticator();
  final config = AppConfig.parse('https://otgolosok.online', dev: false);
  late final SessionStore session;
  late final ApiClient api;
  late GoRouter router;

  /// The last placeholder screen the app navigated to (by `go` or `push`).
  String? opened;

  Future<void> signIn(Map<String, Object?> user) => session.signedIn({'user': user, 'csrfToken': 'csrf-1'});

  /// Pumps [screen] at [location] inside a router that also knows the screens it navigates to.
  Future<void> pump(WidgetTester tester, {required String location, required Map<String, Widget Function(GoRouterState)> screens}) async {
    tester.view.physicalSize = const Size(900, 4000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final translations = loadTranslations();
    router = GoRouter(initialLocation: location, routes: [
      for (final path in {'/', '/builder', '/walk', '/login', '/account', '/account/walks', ...screens.keys})
        GoRoute(path: path, builder: (context, state) {
          final screen = screens[path];
          if (screen != null) return screen(state);
          opened = state.uri.toString();
          return Scaffold(body: Text('screen:$opened'));
        }),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiProvider.overrideWithValue(api),
        sessionStoreProvider.overrideWithValue(session),
        settingsProvider.overrideWithValue(SettingsStore(prefs)),
        translationsProvider.overrideWithValue(translations),
        configProvider.overrideWithValue(config),
        webAuthenticatorProvider.overrideWithValue(web),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => I18n(translations: translations, locale: AppLocale.ru, child: child!),
      ),
    ));
    await tester.pumpAndSettle();
  }

  String get location => router.routerDelegate.currentConfiguration.uri.toString();
}
