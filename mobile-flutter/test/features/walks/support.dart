import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:otgolosok/core/api/api_client.dart';
import 'package:otgolosok/core/api/retry_policy.dart';
import 'package:otgolosok/core/config.dart';

/// One canned answer of [FakeAdapter].
class Reply {
  const Reply(this.status, [this.body, this.headers = const {}]);
  final int status;
  final Object? body;
  final Map<String, List<String>> headers;
}

/// Answers requests by path through [handler] and records what was sent. A [DioExceptionType]
/// answer is thrown as a transport failure.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final Object Function(RequestOptions request) handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final reply = handler(options);
    if (reply is DioExceptionType) throw DioException(requestOptions: options, type: reply);
    reply as Reply;
    final body = reply.body;
    if (body is List<int>) return ResponseBody.fromBytes(body, reply.status, headers: reply.headers);
    return ResponseBody.fromString(body == null ? '' : (body is String ? body : jsonEncode(body)), reply.status, headers: reply.headers);
  }

  @override
  void close({bool force = false}) {}
}

class FakeSession implements ApiSession {
  String? token;

  @override
  String? get csrfToken => token;

  @override
  Future<String?> refreshCsrf() async => token;

  @override
  void onUnauthorized() {}

  @override
  Future<String> guestReviewKey() async => 'k' * 43;
}

/// An API client over [adapter] that never sleeps between retries.
ApiClient fakeApi(FakeAdapter adapter, {String locale = 'ru', FakeSession? session}) => ApiClient(
      config: AppConfig.parse('https://otgolosok.online', dev: false),
      session: session ?? FakeSession(),
      locale: () => locale,
      dio: Dio()..httpClientAdapter = adapter,
      retry: const RetryPolicy(),
      sleep: (_) async {},
    );

Map<String, Object?> _fixture(String name) => jsonDecode(File('test/fixtures/api/$name').readAsStringSync()) as Map<String, Object?>;

/// A deep copy of a fixture case input.
Map<String, Object?> fixtureInput(String file, String group, String caseName) {
  final cases = (_fixture(file)[group]! as List<Object?>).cast<Map<String, Object?>>();
  final found = cases.firstWhere((item) => item['name'] == caseName);
  return jsonDecode(jsonEncode(found['input'])) as Map<String, Object?>;
}

String sha256Hex(List<int> bytes) => sha256.convert(bytes).toString();

/// The fixture's valid Russian view: two stops, the first one with a recording of [audio].
Map<String, Object?> sampleView({List<int>? audio, int revision = 2, String contentVersion = 'v2'}) {
  final view = fixtureInput('walk_view.json', 'views', 'valid');
  view['revision'] = revision;
  view['contentVersion'] = contentVersion;
  if (audio != null) {
    final sha = sha256Hex(audio);
    final chapter = (view['chapters']! as List<Object?>).first! as Map<String, Object?>;
    chapter['audio'] = {'durationSec': 61, 'sha256': sha, 'url': '/api/story-audio/$sha.mp3'};
  }
  return view;
}

/// The fixture's English view (the stories fall back to Russian).
Map<String, Object?> sampleEnglishView() => fixtureInput('walk_view.json', 'views', 'valid english fallback');
