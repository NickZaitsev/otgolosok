/// Where the app talks to: the site origin, fixed at build time.
///
/// `--dart-define=OTGOLOSOK_API_ORIGIN=https://staging.example` points a build at another
/// server; plain http is accepted only together with `--dart-define=OTGOLOSOK_DEV=1`,
/// as in mobile/capacitor-config.ts. Every request sends this origin as `Origin`.
class AppConfig {
  const AppConfig._(this.origin);

  static const _rawOrigin = String.fromEnvironment(
    'OTGOLOSOK_API_ORIGIN',
    defaultValue: 'https://otgolosok.online',
  );
  static const _dev = bool.fromEnvironment('OTGOLOSOK_DEV');

  /// Scheme, host and port only, without a trailing slash.
  final Uri origin;

  String get originHeader => origin.toString();

  static final AppConfig current = parse(_rawOrigin, dev: _dev);

  /// Validates a configured origin; throws [ArgumentError] for anything but a bare origin.
  static AppConfig parse(String raw, {required bool dev}) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw ArgumentError.value(raw, 'OTGOLOSOK_API_ORIGIN', 'ожидался адрес вида https://host');
    }
    if (uri.scheme != 'https' && !(dev && uri.scheme == 'http')) {
      throw ArgumentError.value(raw, 'OTGOLOSOK_API_ORIGIN', 'без OTGOLOSOK_DEV=1 разрешён только https');
    }
    if ((uri.path.isNotEmpty && uri.path != '/') || uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) {
      throw ArgumentError.value(raw, 'OTGOLOSOK_API_ORIGIN', 'адрес должен быть без пути и параметров');
    }
    return AppConfig._(Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null));
  }

  /// An absolute URL on the origin for a site path such as `/legal/terms`.
  Uri siteUrl(String path, [Map<String, String>? query]) =>
      origin.replace(path: path, queryParameters: query == null || query.isEmpty ? null : query);
}
