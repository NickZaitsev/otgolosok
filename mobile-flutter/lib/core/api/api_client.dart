import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config.dart';
import 'api_error.dart';
import 'retry_policy.dart';

/// Turns decoded JSON into a typed value; throws anything to mark the body as corrupt.
typedef Validator<T> = T Function(Object? json);

/// What the client needs from the signed-in state, kept abstract so tests can fake it.
abstract interface class ApiSession {
  /// The CSRF token of the current session, or null for a guest.
  String? get csrfToken;

  /// Re-reads `GET /api/auth/session`; returns the new token or null.
  Future<String?> refreshCsrf();

  /// Called once when a `/api/me*` request answers 401: the session is gone.
  void onUnauthorized();

  /// The guest device key for reviews and feedback (43 base64url characters).
  Future<String> guestReviewKey();
}

/// The UI language for `?lang=`; content endpoints only, as on the site.
typedef LocaleCode = String Function();

/// A response that may be `304 Not Modified` (map cells revalidated by ETag).
class Conditional<T> {
  const Conditional.fresh(T this.value, this.etag) : notModified = false;
  const Conditional.notModified(this.etag)
      : value = null,
        notModified = true;

  final T? value;
  final String? etag;
  final bool notModified;
}

/// HTTP client for the site API: a first-party client of [AppConfig.origin].
///
/// Every request carries `Origin`; writes carry `X-CSRF-Token` when signed in; guest feedback
/// carries `X-Review-Key`. Only idempotent requests are retried ([RetryPolicy]).
class ApiClient {
  ApiClient({
    required this.config,
    required this.session,
    required this.locale,
    required this._dio,
    this.retry = const RetryPolicy(),
    Future<void> Function(Duration)? sleep,
  }) : _sleep = sleep ?? Future<void>.delayed {
    _dio.options
      ..baseUrl = config.originHeader
      ..connectTimeout = RetryPolicy.timeout
      ..sendTimeout = RetryPolicy.timeout
      ..receiveTimeout = RetryPolicy.timeout
      ..responseType = ResponseType.plain
      ..validateStatus = ((_) => true)
      ..followRedirects = false;
    if (kDebugMode) _dio.interceptors.add(RedactingLogInterceptor());
  }

  final AppConfig config;
  final ApiSession session;
  final LocaleCode locale;
  final RetryPolicy retry;
  final Dio _dio;
  final Future<void> Function(Duration) _sleep;

  /// `GET` with retries. [localized] adds `?lang=` for en/zh content.
  Future<T> get<T>(String path, Validator<T> validate,
      {Map<String, String>? query, bool localized = false, bool guestKey = false, CancelToken? cancel}) {
    return _send(_Request('GET', path, query, null, localized, guestKey), validate, retried: true, cancel: cancel);
  }

  /// A write. Retried only when [idempotent] (PUT/DELETE, or a POST carrying an `idempotencyKey`).
  Future<T> send<T>(String method, String path, Validator<T> validate,
      {Object? body,
      Map<String, String>? query,
      bool idempotent = false,
      bool localized = false,
      bool guestKey = false,
      CancelToken? cancel}) {
    assert(method != 'GET', 'use get()');
    return _send(_Request(method, path, query, body, localized, guestKey), validate, retried: idempotent, cancel: cancel);
  }

  /// `GET` with `If-None-Match`; a 304 returns [Conditional.notModified].
  Future<Conditional<T>> getConditional<T>(String path, Validator<T> validate, {String? etag, CancelToken? cancel}) async {
    Conditional<T>? result;
    await _send<void>(
      _Request('GET', path, null, null, false, false, etag: etag),
      (_) {},
      retried: true,
      cancel: cancel,
      onResponse: (response, json) {
        final newEtag = response.headers.value('etag');
        result = response.statusCode == 304 ? Conditional.notModified(newEtag ?? etag) : Conditional.fresh(validate(json), newEtag);
      },
    );
    return result!;
  }

  /// Streams an immutable file (story audio, photos) into [target] with retries; returns its size.
  Future<int> download(Uri url, File target, {CancelToken? cancel, int? maxBytes}) async {
    _requireOwnOrigin(url);
    for (var attempt = 0;; attempt++) {
      try {
        final response = await _dio.downloadUri(url, target.path,
            cancelToken: cancel, options: Options(headers: {'Origin': config.originHeader}, responseType: ResponseType.stream));
        final status = response.statusCode ?? 0;
        if (status != 200) {
          final retryAfter = RetryPolicy.parseRetryAfter(response.headers.value('retry-after'));
          throw ApiError(
            message: 'Не удалось скачать файл.',
            status: status,
            retryable: RetryPolicy.retryableResponse(status, retryAfter),
            retryAfter: retryAfter > RetryPolicy.maxDelay ? RetryPolicy.maxDelay : retryAfter,
          );
        }
        final size = await target.length();
        if (maxBytes != null && size > maxBytes) throw const ApiError(message: 'Файл больше допустимого размера.', code: 'TOO_LARGE');
        return size;
      } on DioException catch (error) {
        final mapped = _transportError(error);
        final delay = retry.delayAfter(attempt, mapped);
        if (delay == null) throw mapped;
        await _sleep(delay);
      } on ApiError catch (error) {
        final delay = retry.delayAfter(attempt, error);
        if (delay == null) rethrow;
        await _sleep(delay);
      }
    }
  }

  void _requireOwnOrigin(Uri url) {
    if (url.origin != config.origin.origin) throw ArgumentError.value(url, 'url', 'only the site origin is downloaded with the API client');
  }

  Future<T> _send<T>(_Request request, Validator<T> validate,
      {required bool retried, CancelToken? cancel, void Function(Response<String>, Object?)? onResponse}) async {
    var csrfRefreshed = false;
    for (var attempt = 0;; attempt++) {
      try {
        final response = await _dio.request<String>(
          request.path,
          data: request.body == null ? null : jsonEncode(request.body),
          queryParameters: _query(request),
          cancelToken: cancel,
          options: Options(method: request.method, headers: await _headers(request)),
        );
        final status = response.statusCode ?? 0;
        final json = _decode(response.data);
        if (status == 304 && onResponse != null) {
          onResponse(response, null);
          return validate(null);
        }
        if (status < 200 || status >= 300) {
          final error = _errorFrom(status, json, response.headers.value('retry-after'));
          if (status == 403 && error.code == 'CSRF' && !csrfRefreshed && session.csrfToken != null) {
            csrfRefreshed = true;
            await session.refreshCsrf();
            attempt--;
            continue;
          }
          if (status == 401 && request.path.startsWith('/api/me')) session.onUnauthorized();
          throw error;
        }
        if (json is _Malformed) throw const ApiError.corrupt();
        try {
          onResponse?.call(response, json);
          return validate(json);
        } catch (_) {
          throw ApiError(message: 'Сервис вернул повреждённые данные.', status: status, code: 'CORRUPT');
        }
      } on DioException catch (error) {
        final mapped = _transportError(error);
        final delay = retried ? retry.delayAfter(attempt, mapped) : null;
        if (delay == null) throw mapped;
        await _sleep(delay);
      } on ApiError catch (error) {
        final delay = retried ? retry.delayAfter(attempt, error) : null;
        if (delay == null) rethrow;
        await _sleep(delay);
      }
      if (cancel?.isCancelled ?? false) throw const ApiError.cancelled();
    }
  }

  Map<String, String>? _query(_Request request) {
    final code = locale();
    if (!request.localized || code == 'ru') return request.query;
    return {...?request.query, 'lang': code};
  }

  Future<Map<String, String>> _headers(_Request request) async {
    final csrf = session.csrfToken;
    return {
      'Origin': config.originHeader,
      'Accept': 'application/json',
      if (request.body != null) 'Content-Type': 'application/json',
      if (request.method != 'GET' && csrf != null) 'X-CSRF-Token': csrf,
      if (request.guestKey && csrf == null) 'X-Review-Key': await session.guestReviewKey(),
      if (request.etag != null) 'If-None-Match': request.etag!,
    };
  }

  static Object? _decode(String? body) {
    if (body == null || body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return const _Malformed();
    }
  }

  static ApiError _errorFrom(int status, Object? json, String? retryAfterHeader) {
    // Site routes answer {error:{code,message}}; Better Auth routes answer {code,message}.
    final error = json is Map<String, Object?> ? json['error'] ?? json : null;
    final fields = error is Map<String, Object?> ? error : const <String, Object?>{};
    final code = fields['code'] is String ? fields['code']! as String : null;
    final message = fields['message'] is String ? fields['message']! as String : 'Не удалось выполнить запрос.';
    final share = fields['share'];
    final moved = code == 'WALK_MOVED' && share is String && _shareToken.hasMatch(share) ? share : null;
    final retryAfter = RetryPolicy.parseRetryAfter(retryAfterHeader);
    return ApiError(
      message: message,
      status: status,
      code: code,
      retryable: RetryPolicy.retryableResponse(status, retryAfter),
      retryAfter: retryAfter > RetryPolicy.maxDelay ? RetryPolicy.maxDelay : retryAfter,
      movedToShare: moved,
    );
  }

  static ApiError _transportError(DioException error) => switch (error.type) {
        DioExceptionType.cancel => const ApiError.cancelled(),
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout =>
          const ApiError.network(timedOut: true),
        DioExceptionType.badCertificate => const ApiError(message: 'Не удалось проверить сертификат сервера.', code: 'TLS'),
        _ => const ApiError.network(),
      };

  static final _shareToken = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
}

class _Request {
  const _Request(this.method, this.path, this.query, this.body, this.localized, this.guestKey, {this.etag});

  final String method;
  final String path;
  final Map<String, String>? query;
  final Object? body;
  final bool localized;
  final bool guestKey;
  final String? etag;
}

class _Malformed {
  const _Malformed();
}

/// Debug-only request log that never prints credentials or one-time codes.
class RedactingLogInterceptor extends Interceptor {
  static const _secretHeaders = {'cookie', 'set-cookie', 'x-csrf-token', 'x-review-key', 'authorization'};
  static final _secretQuery = RegExp(r'(code|verifier|challenge|recoveryToken)=[^&]+');

  static String redactUrl(String url) => url.replaceAllMapped(_secretQuery, (match) => '${match[1]}=***');

  static Map<String, Object?> redactHeaders(Map<String, Object?> headers) => {
        for (final entry in headers.entries) entry.key: _secretHeaders.contains(entry.key.toLowerCase()) ? '***' : entry.value,
      };

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    debugPrint('→ ${options.method} ${redactUrl(options.uri.toString())} ${redactHeaders(options.headers)}');
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    debugPrint('← ${response.statusCode} ${redactUrl(response.requestOptions.uri.toString())}');
    handler.next(response);
  }
}
