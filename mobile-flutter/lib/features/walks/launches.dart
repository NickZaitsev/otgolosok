import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../walk_engine/json_read.dart';
import '../reviews/review_model.dart';

/// Launches are counted for catalogue and link walks only; own and local walks never are.
String? launchesPath(ReviewTarget? target) => switch (target) {
      CatalogReviewTarget(:final id) => '/api/story-walks/${Uri.encodeComponent(id)}/launches',
      SharedReviewTarget(:final token) => '/api/story-walks/shared/${Uri.encodeComponent(token)}/launches',
      _ => null,
    };

bool validateLaunch(Object? json) {
  final counted = readMap(json)['counted'];
  if (counted is! bool) failFormat('Неверный ответ.');
  return counted;
}

/// Reports one press of «Начать прогулку» (site `launches.ts`). The server counts a viewer once a
/// day per walk, so the bounded retries are safe. Resolves false when nothing was sent.
Future<bool> reportWalkLaunch(ApiClient api, ReviewTarget? target, {CancelToken? cancel}) async {
  final path = launchesPath(target);
  if (path == null) return false;
  return api.send('POST', path, validateLaunch, body: const <String, Object?>{}, idempotent: true, guestKey: true, cancel: cancel);
}

/// Reports the launch at most once per opened walk, so resuming or restarting is not counted
/// again. Counting never breaks the walk: every failure is swallowed.
class WalkLaunchReporter {
  WalkLaunchReporter(this._api, this.target);
  final ApiClient _api;
  final ReviewTarget? target;
  final _cancel = CancelToken();
  bool _sent = false;

  bool get sent => _sent;

  void call() {
    if (_sent || launchesPath(target) == null) return;
    _sent = true;
    reportWalkLaunch(_api, target, cancel: _cancel).catchError((Object error) {
      debugPrint('launch report failed: ${error.runtimeType}');
      return false;
    });
  }

  void dispose() => _cancel.cancel();
}
