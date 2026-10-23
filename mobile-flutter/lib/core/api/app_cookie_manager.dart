import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';

import 'api_client.dart';

/// [CookieManager] that leaves alone requests flagged with [ApiClient.bypassCookieJar]: their
/// explicit `Cookie` header is sent as is and their `Set-Cookie` never reaches the jar.
class AppCookieManager extends CookieManager {
  AppCookieManager(super.cookieJar);

  static bool _bypassed(RequestOptions options) => options.extra[ApiClient.bypassCookieJar] == true;

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (_bypassed(options)) return handler.next(options);
    return super.onRequest(options, handler);
  }

  @override
  Future<void> onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) async {
    if (_bypassed(response.requestOptions)) return handler.next(response);
    return super.onResponse(response, handler);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    if (_bypassed(err.requestOptions)) return handler.next(err);
    return super.onError(err, handler);
  }
}
