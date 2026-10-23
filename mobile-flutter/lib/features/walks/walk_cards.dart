import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/json_read.dart';
import 'local_walks.dart';
import 'top_model.dart';

enum WalkVisibility { private, shared, public }

enum ListingStatus { pending, approved, hidden }

enum WalkCardKind { account, local }

/// A walk in «Мои прогулки» (site `WalkCard`): a walk on this device, or an account walk as
/// `backend/account-store.mjs` sends it (`listItem` in lists, `viewWalk` in single-walk answers).
@immutable
class WalkCard {
  const WalkCard({
    required this.kind,
    required this.id,
    required this.title,
    required this.revision,
    this.subtitle,
    this.updatedAt,
    this.visibility,
    this.shareToken,
    this.listingStatus,
    this.draft = false,
    this.driving = false,
    this.totalMinutes,
    this.walkingMinutes,
    this.distanceM,
  });

  /// An account walk of `GET /api/me/walks` or of a single-walk answer; a walk whose snapshot the
  /// server could not read has no route fields.
  factory WalkCard.account(Object? json) => _accountCard(json);

  /// A local walk as a card (site `walk-library.tsx`).
  factory WalkCard.local(LocalWalk walk) {
    final document = walk.document, route = document.route;
    return WalkCard(
      kind: WalkCardKind.local,
      id: document.id,
      title: document.title,
      subtitle: document.description,
      revision: walk.revision,
      updatedAt: walk.updatedAt?.toUtc().toIso8601String(),
      draft: route == null,
      driving: document.driving,
      totalMinutes: route?.car?.totalMinutes.toDouble() ?? route?.walkingMinutes,
      walkingMinutes: route?.walkingMinutes,
      distanceM: route?.distanceM,
    );
  }

  final WalkCardKind kind;
  final String id;
  final String title;
  final String? subtitle;
  final int revision;

  /// ISO time; cards are sorted by it, newest first, as strings like on the site.
  final String? updatedAt;
  final WalkVisibility? visibility;
  final String? shareToken;
  final ListingStatus? listingStatus;
  final bool draft;
  final bool driving;
  final double? totalMinutes;
  final double? walkingMinutes;
  final double? distanceM;

  /// The Russian source of the access line (site `accessLabel`): the state is never shown by
  /// colour alone. A public walk without a listing state is still under review.
  String get accessLabel => switch ((visibility, listingStatus)) {
        (WalkVisibility.shared, _) => 'По ссылке',
        (WalkVisibility.public, ListingStatus.approved) => 'Всем · в топе',
        (WalkVisibility.public, ListingStatus.hidden) => 'Всем · скрыта редакцией из топа',
        (WalkVisibility.public, _) => 'Всем · на проверке',
        _ => 'Только я',
      };

  /// Public, but not yet in the top: the editors review it first.
  bool get awaitsReview => visibility == WalkVisibility.public && listingStatus == ListingStatus.pending;

  /// The walk page of this card.
  String get location => Uri(path: '/walk', queryParameters: {kind == WalkCardKind.local ? 'local' : 'id': id}).toString();

  /// The builder of this card (site `/?walk=create&id=…&edit=1`).
  String get editLocation => Uri(path: '/builder', queryParameters: {kind == WalkCardKind.local ? 'local' : 'id': id, 'edit': '1'}).toString();

  /// Applies the access fields of a `PUT …/sharing` answer.
  WalkCard withAccess(WalkAccess access) => WalkCard(
        kind: kind,
        id: id,
        title: title,
        subtitle: subtitle,
        revision: access.revision,
        updatedAt: access.updatedAt ?? updatedAt,
        visibility: access.visibility,
        shareToken: access.shareToken,
        listingStatus: access.listingStatus,
        draft: draft,
        driving: driving,
        totalMinutes: totalMinutes,
        walkingMinutes: walkingMinutes,
        distanceM: distanceM,
      );
}

/// The access part of an account walk, as `PUT /api/me/walks/{id}/sharing` returns it.
@immutable
class WalkAccess {
  const WalkAccess({required this.revision, required this.visibility, required this.shareToken, required this.listingStatus, this.updatedAt});
  final int revision;
  final WalkVisibility visibility;
  final String? shareToken;
  final ListingStatus? listingStatus;
  final String? updatedAt;

  bool get awaitsReview => visibility == WalkVisibility.public && listingStatus == ListingStatus.pending;
}

T _enum<T extends Enum>(List<T> values, Object? value, String message) =>
    values.where((item) => item.name == value).firstOrNull ?? failFormat(message);

WalkAccess _access(Map<String, Object?> item) {
  final revision = item['revision'], token = item['shareToken'], status = item['listingStatus'], updated = item['updatedAt'];
  if (!jsIsSafeInteger(revision) || (revision! as num) < 0) failFormat('Неверная версия прогулки.');
  if (token != null && (token is! String || !walkUuid.hasMatch(token))) failFormat('Неверная ссылка прогулки.');
  if (updated != null && updated is! String) failFormat('Неверная дата прогулки.');
  final visibility = _enum(WalkVisibility.values, item['visibility'], 'Неверный доступ к прогулке.');
  if (visibility != WalkVisibility.private && token == null) failFormat('Неверная ссылка прогулки.');
  return WalkAccess(
    revision: (revision as num).toInt(),
    visibility: visibility,
    shareToken: visibility == WalkVisibility.private ? null : token as String?,
    listingStatus: status == null ? null : _enum(ListingStatus.values, status, 'Неверный статус прогулки в топе.'),
    updatedAt: updated as String?,
  );
}

double? _optionalPositive(Object? value) {
  if (value == null) return null;
  if (value is! num || !value.isFinite || value < 0) failFormat('Неверная прогулка.');
  return value.toDouble();
}

WalkCard _accountCard(Object? raw) {
  final item = readMap(raw);
  final id = item['id'], title = item['title'], draft = item['draft'], mode = item['travelMode'];
  if (id is! String || !walkUuid.hasMatch(id) || title is! String) failFormat('Неверная прогулка.');
  if (draft != null && draft is! bool) failFormat('Неверная прогулка.');
  if (mode != null && mode != 'walking' && mode != 'driving') failFormat('Неверный режим поездки.');
  final access = _access(item);
  return WalkCard(
    kind: WalkCardKind.account,
    id: id,
    title: title,
    revision: access.revision,
    updatedAt: access.updatedAt,
    visibility: access.visibility,
    shareToken: access.shareToken,
    listingStatus: access.listingStatus,
    draft: draft == true,
    driving: mode == 'driving',
    totalMinutes: _optionalPositive(item['totalMinutes']),
    walkingMinutes: _optionalPositive(item['walkingMinutes']),
    distanceM: _optionalPositive(item['distanceM']),
  );
}

/// `GET /api/me/walks[?cursor=]`: `{walks, nextCursor}`.
({List<WalkCard> walks, String? nextCursor}) validateAccountWalks(Object? json) {
  final page = readMap(json);
  final walks = page['walks'], cursor = page['nextCursor'];
  if (walks is! List<Object?> || (cursor != null && (cursor is! String || cursor.isEmpty))) failFormat('Неверный список прогулок.');
  return (walks: [for (final raw in walks) _accountCard(raw)], nextCursor: cursor as String?);
}

WalkAccess validateSharingAnswer(Object? json) => _access(readMap(readMap(json)['walk']));

/// Account walks: the list, its pages and the access level.
class AccountWalksApi {
  const AccountWalksApi(this._api);
  final ApiClient _api;

  Future<({List<WalkCard> walks, String? nextCursor})> list({String? cursor}) =>
      _api.get('/api/me/walks', validateAccountWalks, query: cursor == null ? null : {'cursor': cursor});

  /// PUT replaces the access level, so a retry after a lost answer is safe.
  Future<WalkAccess> setVisibility(String id, int revision, WalkVisibility visibility) => _api.send(
        'PUT',
        '/api/me/walks/${Uri.encodeComponent(id)}/sharing',
        validateSharingAnswer,
        body: {'revision': revision, 'visibility': visibility.name},
        idempotent: true,
      );
}

/// The site address of a shared walk in the UI language (site `path('/walk?share=…')`).
Uri sharedWalkUrl(Uri origin, String token, AppLocale locale) =>
    origin.replace(path: locale == AppLocale.ru ? '/walk' : '/${locale.name}/walk', queryParameters: {'share': token});

/// Account and local cards together, newest first (site sorts by the `updatedAt` strings).
List<WalkCard> sortCards(Iterable<WalkCard> cards) =>
    [...cards]..sort((a, b) => (b.updatedAt ?? '').compareTo(a.updatedAt ?? ''));
