/// Site links that open the app (Android App Links: `/`, `/walk`, `/place/<type>/<id>`), mapped to
/// app locations like `inAppPathFromUrl` in src/features/native/app-links.ts.
library;

final _placeShare = RegExp(r'^/place/(node|way|relation)/([1-9]\d{0,18})$');
final _placeId = RegExp(r'^osm:(node|way|relation):([1-9]\d{0,18})$');
final _localePrefix = RegExp(r'^/(en|zh)(?=/|$)');

bool isPlaceId(String? value) => value != null && _placeId.hasMatch(value);

/// `/place/node/123` — the share path messengers keep intact; en/zh add `?lang=`.
String placeSharePath(String id, {String locale = 'ru'}) {
  final match = _placeId.firstMatch(id);
  if (match == null) throw ArgumentError.value(id, 'id', 'not a place id');
  final path = '/place/${match[1]}/${match[2]}';
  return locale == 'ru' ? path : '$path?lang=$locale';
}

/// The app location for an incoming link [uri], or null when the app must not open it.
///
/// [uri] is either absolute (checked against [origin]) or a path as the Flutter engine passes it.
String? inAppLocation(Uri uri, Uri origin) {
  if (uri.hasScheme && (uri.scheme != origin.scheme || uri.host != origin.host || uri.port != origin.port)) return null;
  final share = _placeShare.firstMatch(uri.path);
  if (share != null) return Uri(path: '/', queryParameters: {'place': 'osm:${share[1]}:${share[2]}'}).toString();
  final path = uri.path.replaceFirst(_localePrefix, '').replaceFirst(RegExp(r'/+$'), '');
  if (path.isEmpty || path == '/') return _withQuery('/', uri.queryParameters, const {'place', 'walk'});
  if (path == '/walk') return _withQuery('/walk', uri.queryParameters, const {'catalog', 'share', 'id', 'local', 'fromStop'});
  return null;
}

/// Keeps only parameters the app understands; a damaged `place` value is dropped.
String _withQuery(String path, Map<String, String> query, Set<String> allowed) {
  final kept = {
    for (final entry in query.entries)
      if (allowed.contains(entry.key) && (entry.key != 'place' || isPlaceId(entry.value))) entry.key: entry.value,
  };
  return Uri(path: path, queryParameters: kept.isEmpty ? null : kept).toString();
}
