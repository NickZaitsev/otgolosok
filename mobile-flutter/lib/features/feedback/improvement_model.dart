import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../walk_engine/json_read.dart';
import '../reviews/review_model.dart';

/// What a viewer may ask the editors to improve, in the server's canonical order.
enum ImprovementIssue {
  shortText('short_text'),
  noImages('no_images'),
  voiceover('voiceover');

  const ImprovementIssue(this.wire);
  final String wire;
}

enum ImprovementStatus { open, resolved }

@immutable
class MyImprovement {
  const MyImprovement({required this.issues, required this.status, required this.updatedAt});
  final List<ImprovementIssue> issues;
  final ImprovementStatus status;
  final String updatedAt;
}

/// `{mine: null | {issues, status, updatedAt}}` (site `validateImprovement`).
MyImprovement? validateImprovement(Object? json) {
  final value = readMap(json);
  if (!value.containsKey('mine')) failFormat('Неверный запрос на улучшение.');
  final mine = value['mine'];
  if (mine == null) return null;
  final item = readMap(mine);
  final issues = item['issues'];
  if (issues is! List<Object?> || issues.isEmpty) failFormat('Неверный список причин.');
  final parsed = [
    for (final issue in issues) ImprovementIssue.values.where((value) => value.wire == issue).firstOrNull ?? failFormat('Неверный список причин.'),
  ];
  final status = ImprovementStatus.values.where((value) => value.name == item['status']).firstOrNull ?? failFormat('Неверный статус запроса.');
  final updated = item['updatedAt'];
  if (updated is! String) failFormat('Неверная дата запроса.');
  return MyImprovement(issues: parsed, status: status, updatedAt: updated);
}

/// The selection in canonical order, as the server stores it, so a no-op edit is easy to spot.
List<ImprovementIssue> canonicalIssues(Iterable<ImprovementIssue> selected) {
  final set = selected.toSet();
  return [for (final issue in ImprovementIssue.values) if (set.contains(issue)) issue];
}

/// Requests live beside the reviews of the same walk: `/…/reviews` becomes `/…/improvements/mine`.
String improvementPath(ReviewTarget target) => target.reviewsPath.replaceFirst(RegExp(r'/reviews$'), '/improvements/mine');

/// One request per viewer and walk; identity as for reviews (session or guest key).
class ImprovementsApi {
  const ImprovementsApi(this._api);
  final ApiClient _api;

  Future<MyImprovement?> load(ReviewTarget target) => _api.get(improvementPath(target), validateImprovement, guestKey: true);

  /// PUT replaces the whole request (an empty list withdraws it), so a retry is safe.
  Future<MyImprovement?> save(ReviewTarget target, List<ImprovementIssue> issues) => _api.send(
        'PUT',
        improvementPath(target),
        validateImprovement,
        body: {'issues': [for (final issue in canonicalIssues(issues)) issue.wire]},
        idempotent: true,
        guestKey: true,
      );
}
