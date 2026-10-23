import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_client.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/core/api/retry_policy.dart';
import 'package:otgolosok/core/config.dart';

class _Reply {
  const _Reply(this.status, [this.body, this.headers = const {}]);
  final int status;
  final Object? body;
  final Map<String, List<String>> headers;
}

/// Answers requests from a queue and records what was sent.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.replies);

  final List<Object> replies;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final reply = replies.removeAt(0);
    if (reply is DioExceptionType) throw DioException(requestOptions: options, type: reply);
    reply as _Reply;
    final body = reply.body == null ? '' : (reply.body is String ? reply.body! as String : jsonEncode(reply.body));
    return ResponseBody.fromString(body, reply.status, headers: reply.headers);
  }

  @override
  void close({bool force = false}) {}
}

class _FakeSession implements ApiSession {
  String? token;
  int refreshes = 0;
  int unauthorized = 0;

  @override
  String? get csrfToken => token;

  @override
  Future<String?> refreshCsrf() async {
    refreshes++;
    return token = 'fresh';
  }

  @override
  void onUnauthorized() => unauthorized++;

  @override
  Future<String> guestReviewKey() async => 'k' * 43;
}

void main() {
  late _FakeAdapter adapter;
  late _FakeSession session;
  late List<Duration> sleeps;
  var locale = 'ru';

  ApiClient client(List<Object> replies) {
    adapter = _FakeAdapter(replies);
    session = _FakeSession();
    sleeps = [];
    return ApiClient(
      config: AppConfig.parse('https://otgolosok.online', dev: false),
      session: session,
      locale: () => locale,
      dio: Dio()..httpClientAdapter = adapter,
      retry: RetryPolicy(random: Random(1)),
      sleep: (duration) async => sleeps.add(duration),
    );
  }

  Object? identity(Object? json) => json;

  setUp(() => locale = 'ru');

  test('sends Origin, lang only for localized requests, and decodes JSON', () async {
    locale = 'en';
    final api = client([const _Reply(200, {'ok': true}), const _Reply(200, {'ok': 1})]);
    expect(await api.get('/api/content/places/osm:node:1', identity, localized: true), {'ok': true});
    await api.get('/api/me', identity);
    expect(adapter.requests[0].headers['Origin'], 'https://otgolosok.online');
    expect(adapter.requests[0].uri.queryParameters, {'lang': 'en'});
    expect(adapter.requests[1].uri.queryParameters, isEmpty);
  });

  test('retries 5xx and network errors with growing backoff, then succeeds', () async {
    final api = client([const _Reply(503), DioExceptionType.connectionError, const _Reply(200, {'v': 1})]);
    expect(await api.get('/api/top-walks', identity), {'v': 1});
    expect(adapter.requests, hasLength(3));
    expect(sleeps[0].inMilliseconds, inInclusiveRange(500, 749));
    expect(sleeps[1].inMilliseconds, inInclusiveRange(1000, 1249));
  });

  test('gives up after three attempts with the last error', () async {
    final api = client([const _Reply(500), const _Reply(502), const _Reply(503, {'error': {'code': 'DOWN', 'message': 'Нет'}})]);
    await expectLater(api.get('/x', identity), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'DOWN').having((e) => e.status, 'status', 503)));
    expect(adapter.requests, hasLength(3));
  });

  test('Retry-After up to 5 s is honoured, above 5 s fails at once', () async {
    var api = client([
      const _Reply(429, null, {'retry-after': ['2']}),
      const _Reply(200, {'v': 1}),
    ]);
    await api.get('/x', identity);
    expect(sleeps.single.inMilliseconds, inInclusiveRange(2000, 2249));

    api = client([const _Reply(429, null, {'retry-after': ['6']})]);
    await expectLater(api.get('/x', identity), throwsA(isA<ApiError>().having((e) => e.retryable, 'retryable', false)));
    expect(adapter.requests, hasLength(1));
  });

  test('4xx and non-idempotent writes are not retried', () async {
    var api = client([const _Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'Нет'}})]);
    await expectLater(api.get('/x', identity), throwsA(isA<ApiError>()));
    expect(adapter.requests, hasLength(1));

    api = client([const _Reply(503)]);
    await expectLater(api.send('POST', '/api/walk-plan', identity, body: const {'a': 1}), throwsA(isA<ApiError>()));
    expect(adapter.requests, hasLength(1));
  });

  test('410 WALK_MOVED carries the share token', () async {
    const share = '11111111-1111-4111-8111-111111111111';
    final api = client([const _Reply(410, {'error': {'code': 'WALK_MOVED', 'message': 'Переехала', 'share': share}})]);
    await expectLater(api.get('/api/story-walks/a/view', identity), throwsA(isA<ApiError>().having((e) => e.movedToShare, 'share', share)));
  });

  test('invalid JSON and a failed validator are corrupt, not retried', () async {
    var api = client([const _Reply(200, '{oops')]);
    await expectLater(api.get('/x', identity), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'CORRUPT')));
    api = client([const _Reply(200, {'v': 1})]);
    await expectLater(api.get('/x', (_) => throw const FormatException()), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'CORRUPT')));
    expect(adapter.requests, hasLength(1));
  });

  test('writes carry CSRF; a CSRF rejection refreshes the token once and retries', () async {
    final api = client([
      const _Reply(403, {'error': {'code': 'CSRF', 'message': 'Обновите'}}),
      const _Reply(200, {'ok': true}),
    ]);
    session.token = 'stale';
    await api.send('PATCH', '/api/me', identity, body: const {'name': 'Аня'});
    expect(session.refreshes, 1);
    expect(adapter.requests[0].headers['X-CSRF-Token'], 'stale');
    expect(adapter.requests[1].headers['X-CSRF-Token'], 'fresh');

    final again = client([
      const _Reply(403, {'error': {'code': 'CSRF', 'message': 'Обновите'}}),
      const _Reply(403, {'error': {'code': 'CSRF', 'message': 'Обновите'}}),
    ]);
    session.token = 'stale';
    await expectLater(again.send('PATCH', '/api/me', identity, body: const {}), throwsA(isA<ApiError>()));
    expect(session.refreshes, 1);
  });

  test('401 from /api/me clears the session once; elsewhere it does not', () async {
    final api = client([const _Reply(401), const _Reply(401)]);
    await expectLater(api.get('/api/me/walks', identity), throwsA(isA<ApiError>()));
    await expectLater(api.get('/api/story-jobs', identity), throwsA(isA<ApiError>()));
    expect(session.unauthorized, 1);
  });

  test('guest feedback carries the review key only without a session', () async {
    final api = client([const _Reply(200, {}), const _Reply(200, {})]);
    await api.send('POST', '/api/reviews', identity, body: const {}, guestKey: true);
    session.token = 'csrf';
    await api.send('POST', '/api/reviews', identity, body: const {}, guestKey: true);
    expect(adapter.requests[0].headers['X-Review-Key'], 'k' * 43);
    expect(adapter.requests[1].headers.containsKey('X-Review-Key'), isFalse);
  });

  test('getConditional sends If-None-Match and reports 304', () async {
    final api = client([const _Reply(304, null, {'etag': ['"a"']}), const _Reply(200, {'v': 2}, {'etag': ['"b"']})]);
    final cached = await api.getConditional('/api/content/map-cells', identity, etag: '"a"');
    expect(cached.notModified, isTrue);
    expect(adapter.requests[0].headers['If-None-Match'], '"a"');
    final fresh = await api.getConditional('/api/content/map-cells', identity, etag: '"a"');
    expect(fresh.value, {'v': 2});
    expect(fresh.etag, '"b"');
  });

  test('log redaction hides credentials and one-time codes', () {
    expect(RedactingLogInterceptor.redactUrl('https://x/a?code=abc&lang=en&verifier=zzz'), 'https://x/a?code=***&lang=en&verifier=***');
    expect(RedactingLogInterceptor.redactHeaders({'Cookie': 'a', 'X-CSRF-Token': 'b', 'Origin': 'o'}), {'Cookie': '***', 'X-CSRF-Token': '***', 'Origin': 'o'});
  });

  group('AppConfig.parse', () {
    test('accepts a bare https origin', () => expect(AppConfig.parse('https://otgolosok.online/', dev: false).originHeader, 'https://otgolosok.online'));
    test('allows http only in dev', () {
      expect(() => AppConfig.parse('http://10.0.2.2:3000', dev: false), throwsArgumentError);
      expect(AppConfig.parse('http://10.0.2.2:3000', dev: true).originHeader, 'http://10.0.2.2:3000');
    });
    test('rejects paths and queries', () {
      expect(() => AppConfig.parse('https://x.ru/api', dev: false), throwsArgumentError);
      expect(() => AppConfig.parse('https://x.ru?a=1', dev: false), throwsArgumentError);
      expect(() => AppConfig.parse('otgolosok', dev: false), throwsArgumentError);
    });
  });
}
