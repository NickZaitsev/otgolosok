import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';

/// One page of an account list with its opaque cursor.
@immutable
class AccountPage<T> {
  const AccountPage(this.items, this.nextCursor);

  final List<T> items;
  final String? nextCursor;
}

/// `GET /api/me/favorites` item (backend/favorite-summary.mjs).
@immutable
class Favorite {
  const Favorite({required this.type, required this.id, required this.createdAt, this.title, this.href});

  static Favorite fromJson(Object? json) {
    final map = _object(json);
    final type = map['type'], id = map['id'], createdAt = map['createdAt'], title = map['title'], href = map['href'];
    if (type is! String || id is! String || id.isEmpty || createdAt is! String) throw const FormatException('favorite');
    if ((title != null && title is! String) || (href != null && href is! String)) throw const FormatException('favorite');
    return Favorite(type: type, id: id, createdAt: createdAt, title: title as String?, href: href as String?);
  }

  final String type;
  final String id;
  final String createdAt;
  final String? title;
  final String? href;

  String get key => '$type:$id';

  /// The in-app location of a favourite walk; null when the app cannot open it (stories, gone items).
  String? get walkLocation {
    final link = href;
    if (link == null || !link.startsWith('/walk?')) return null;
    final uri = Uri.tryParse(link);
    if (uri == null) return null;
    final query = uri.queryParameters;
    const sources = {'id', 'catalog', 'share'};
    if (query.length != 1 || !sources.contains(query.keys.single)) return null;
    return Uri(path: '/walk', queryParameters: query).toString();
  }
}

/// `GET /api/me/requests` item: a story or walk research the user ordered.
@immutable
class StoryRequest {
  const StoryRequest({required this.jobId, required this.operation, required this.createdAt});

  static StoryRequest fromJson(Object? json) {
    final map = _object(json);
    final jobId = map['jobId'], operation = map['operation'], createdAt = map['createdAt'];
    if (jobId is! String || operation is! String || createdAt is! String || DateTime.tryParse(createdAt) == null) {
      throw const FormatException('request');
    }
    return StoryRequest(jobId: jobId, operation: operation, createdAt: createdAt);
  }

  final String jobId;
  final String operation;
  final String createdAt;

  String get key => '$jobId:$createdAt';
  bool get walkResearch => operation == 'walk_research';
}

enum WalkVisibility { private, shared, public }

enum ListingStatus { pending, approved, hidden }

/// A walk saved in the account (`GET /api/me/walks` item, backend/account-store.mjs `listItem`).
@immutable
class AccountWalk {
  const AccountWalk({
    required this.id,
    required this.title,
    required this.revision,
    required this.visibility,
    this.updatedAt,
    this.shareToken,
    this.listingStatus,
    this.draft = false,
    this.driving = false,
    this.totalMinutes,
    this.walkingMinutes,
    this.distanceM,
  });

  static final _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

  static AccountWalk fromJson(Object? json) {
    final map = _object(json);
    final id = map['id'], title = map['title'], revision = map['revision'], updatedAt = map['updatedAt'];
    final share = map['shareToken'], draft = map['draft'], mode = map['travelMode'];
    if (id is! String || !_uuid.hasMatch(id) || title is! String || revision is! int || revision < 0) throw const FormatException('walk');
    if ((updatedAt != null && updatedAt is! String) || (share != null && (share is! String || !_uuid.hasMatch(share)))) {
      throw const FormatException('walk');
    }
    if ((draft != null && draft is! bool) || (mode != null && mode != 'walking' && mode != 'driving')) throw const FormatException('walk');
    final visibility = WalkVisibility.values.where((value) => value.name == map['visibility']).firstOrNull;
    if (visibility == null) throw const FormatException('visibility');
    final listing = map['listingStatus'];
    final status = ListingStatus.values.where((value) => value.name == listing).firstOrNull;
    if (listing != null && status == null) throw const FormatException('listingStatus');
    return AccountWalk(
      id: id,
      title: title,
      revision: revision,
      visibility: visibility,
      updatedAt: updatedAt as String?,
      shareToken: share as String?,
      listingStatus: status,
      draft: draft == true,
      driving: mode == 'driving',
      totalMinutes: _count(map['totalMinutes']),
      walkingMinutes: _count(map['walkingMinutes']),
      distanceM: _count(map['distanceM']),
    );
  }

  static num? _count(Object? value) {
    if (value == null) return null;
    if (value is! num || !value.isFinite || value < 0) throw const FormatException('number');
    return value;
  }

  final String id;
  final String title;
  final int revision;
  final WalkVisibility visibility;
  final String? updatedAt;
  final String? shareToken;
  final ListingStatus? listingStatus;
  final bool draft;
  final bool driving;
  final num? totalMinutes;
  final num? walkingMinutes;
  final num? distanceM;

  /// The access line in words (site `accessLabel`): the state is never shown by colour alone.
  String get accessLabel => switch ((visibility, listingStatus)) {
        (WalkVisibility.shared, _) => 'По ссылке',
        (WalkVisibility.private, _) => 'Только я',
        (WalkVisibility.public, ListingStatus.approved) => 'Всем · в топе',
        (WalkVisibility.public, ListingStatus.hidden) => 'Всем · скрыта редакцией из топа',
        (WalkVisibility.public, _) => 'Всем · на проверке',
      };

  bool get awaitsReview => visibility == WalkVisibility.public && listingStatus == ListingStatus.pending;
}

Map<String, Object?> _object(Object? json) {
  if (json is! Map<String, Object?>) throw const FormatException('object');
  return json;
}

AccountPage<T> _page<T>(Object? json, String key, T Function(Object?) item) {
  final map = _object(json);
  final list = map[key], cursor = map['nextCursor'];
  if (list is! List<Object?> || (cursor != null && (cursor is! String || cursor.isEmpty))) throw FormatException(key);
  return AccountPage([for (final value in list) item(value)], cursor as String?);
}

/// Appends a page without duplicates (site `mergePage`).
List<T> mergePage<T>(List<T> current, List<T> incoming, String Function(T) key) {
  final seen = current.map(key).toSet();
  return [...current, ...incoming.where((item) => seen.add(key(item)))];
}

/// `/api/me*` calls of the profile and «Мои прогулки» (site src/features/account/account.tsx).
class AccountRepository {
  AccountRepository({required this.api, required this.session});

  final ApiClient api;
  final SessionStore session;

  static Map<String, String>? _cursor(String? cursor) => cursor == null ? null : {'cursor': cursor};

  Future<AccountPage<Favorite>> favorites({String? cursor}) =>
      api.get('/api/me/favorites', (json) => _page(json, 'favorites', Favorite.fromJson), query: _cursor(cursor));

  Future<AccountPage<StoryRequest>> requests({String? cursor}) =>
      api.get('/api/me/requests', (json) => _page(json, 'requests', StoryRequest.fromJson), query: _cursor(cursor));

  Future<AccountPage<AccountWalk>> walks({String? cursor}) =>
      api.get('/api/me/walks', (json) => _page(json, 'walks', AccountWalk.fromJson), query: _cursor(cursor));

  /// `PUT /api/me/walks/{id}/sharing`; the server answers the same walk when the change is repeated.
  Future<AccountWalk> setVisibility(AccountWalk walk, WalkVisibility visibility) => api.send(
        'PUT',
        '/api/me/walks/${walk.id}/sharing',
        (json) => AccountWalk.fromJson(_object(json)['walk']),
        body: {'revision': walk.revision, 'visibility': visibility.name},
        idempotent: true,
      );

  /// `PATCH /api/me {name}`; the session keeps the returned profile.
  Future<AuthUser> rename(String name) async {
    final user = await api.send('PATCH', '/api/me', (json) => AuthUser.fromJson(_object(json)['user'])!, body: {'name': name}, idempotent: true);
    final current = session.user;
    // The PATCH answer has no Telegram re-auth state; keep the session's.
    session.updateUser(current != null && current.id == user.id ? current.copyWith(name: user.name) : user);
    return user;
  }

  /// `DELETE /api/me`: a password account confirms with its password, a Telegram one with a fresh
  /// Telegram sign-in (403 `REAUTH_REQUIRED` otherwise). The local session is cleared on success.
  Future<void> deleteAccount({String? password}) async {
    final user = session.user;
    if (user == null) throw const ApiError(message: 'Войдите в аккаунт.', status: 401, code: 'UNAUTHORIZED');
    await api.send('DELETE', '/api/me', (_) {}, body: user.telegram ? const <String, Object?>{} : {'password': password ?? ''});
    await session.accountDeleted();
  }

  /// Marks the Telegram account as needing a fresh sign-in after a 403 `REAUTH_REQUIRED`.
  void requireReauthentication() {
    final user = session.user;
    if (user == null || !user.telegram) return;
    session.updateUser(AuthUser(id: user.id, name: user.name, email: user.email, telegram: true, requiresReauthentication: true));
  }

  /// `POST /api/auth/revoke-sessions`, then the local sign-out.
  Future<void> signOutEverywhere() async {
    await api.send('POST', '/api/auth/revoke-sessions', (_) {}, body: const <String, Object?>{});
    await session.signOut();
  }
}

final accountRepositoryProvider = Provider<AccountRepository>(
  (ref) => AccountRepository(api: ref.watch(apiProvider), session: ref.watch(sessionStoreProvider)),
);
