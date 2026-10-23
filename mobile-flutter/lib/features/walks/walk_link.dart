/// Which walk `/walk?…` opens, as `src/features/walks/walk-loader.ts` reads the same parameters.
sealed class WalkLink {
  const WalkLink({this.fromStop});

  /// Starts the walk at this stop instead of the first one or the checkpoint.
  final String? fromStop;

  static final _slug = RegExp(r'^[a-z0-9][a-z0-9-]{0,127}$');
  static final _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);

  /// Null for a damaged or empty link; exactly one source parameter is accepted.
  static WalkLink? parse(Map<String, String> query) {
    final fromStop = query['fromStop'];
    final stop = fromStop != null && _slug.hasMatch(fromStop) || fromStop != null && _uuid.hasMatch(fromStop) ? fromStop : null;
    final sources = [
      if (query['catalog'] case final value? when _slug.hasMatch(value)) CatalogWalkLink(value, fromStop: stop),
      if (query['share'] case final value? when _uuid.hasMatch(value)) SharedWalkLink(value.toLowerCase(), fromStop: stop),
      if (query['id'] case final value? when _uuid.hasMatch(value)) AccountWalkLink(value.toLowerCase(), fromStop: stop),
      if (query['local'] case final value? when _uuid.hasMatch(value)) LocalWalkLink(value.toLowerCase(), fromStop: stop),
    ];
    final given = ['catalog', 'share', 'id', 'local'].where(query.containsKey).length;
    return sources.length == 1 && given == 1 ? sources.single : null;
  }

  Map<String, String> get query;

  String get location => Uri(path: '/walk', queryParameters: {...query, 'fromStop': ?fromStop}).toString();
}

class CatalogWalkLink extends WalkLink {
  const CatalogWalkLink(this.slug, {super.fromStop});
  final String slug;
  @override
  Map<String, String> get query => {'catalog': slug};
}

class SharedWalkLink extends WalkLink {
  const SharedWalkLink(this.token, {super.fromStop});
  final String token;
  @override
  Map<String, String> get query => {'share': token};
}

class AccountWalkLink extends WalkLink {
  const AccountWalkLink(this.id, {super.fromStop});
  final String id;
  @override
  Map<String, String> get query => {'id': id};
}

class LocalWalkLink extends WalkLink {
  const LocalWalkLink(this.id, {super.fromStop});
  final String id;
  @override
  Map<String, String> get query => {'local': id};
}
