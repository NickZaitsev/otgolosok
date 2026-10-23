// The builder's server calls. Answers are returned raw where the caller must check them against its
// own state (a plan against the draft it was built for), and parsed here otherwise.
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/api/api_client.dart';
import '../../walk_engine/car_route.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/js_json.dart';
import '../walks/walk_cards.dart' show WalkCard;
import 'model.dart';
import 'parking.dart';
import 'throttle.dart';

/// `GET /api/story-jobs/{id}` and `POST /api/story-jobs` answers as the builder reads them.
typedef StoryJob = ({String id, GenerationStage stage, String? address});

StoryJob readStoryJob(Object? value) {
  final map = value is Map<String, Object?> ? value : null;
  final id = map?['id'], stage = GenerationStage.parse(map?['stage']), address = map?['address'];
  if (!isJobId(id) || stage == null) throw const ModelError('Не удалось прочитать состояние истории.');
  return (id: id! as String, stage: stage, address: address is String ? address : null);
}

/// A walk of the account as the builder edits it (`GET /api/me/walks/{id}`).
class AccountWalkRecord {
  const AccountWalkRecord({required this.walk, required this.snapshot, this.snapshotError});

  factory AccountWalkRecord.fromJson(Object? json) {
    final walk = json is Map<String, Object?> ? json['walk'] : null;
    if (walk is! Map<String, Object?>) throw const FormatException('walk');
    final error = walk['snapshotError'];
    if (error != null && error is! String) throw const FormatException('snapshotError');
    return AccountWalkRecord(walk: WalkCard.account(walk), snapshot: walk['snapshot'], snapshotError: error as String?);
  }

  final WalkCard walk;

  /// A version-2 walk document, or a legacy draft; checked by the caller.
  final Object? snapshot;
  final String? snapshotError;
}

Object? _raw(Object? json) => json;

class BuilderApi {
  BuilderApi(this._api, {Clock clock = const SystemClock()})
      : _places = RequestThrottle(const Duration(milliseconds: 1100), clock),
        _plans = RequestThrottle(const Duration(seconds: 2), clock);

  final ApiClient _api;
  final RequestThrottle _places;
  final RequestThrottle _plans;

  /// `GET /api/story-place`: the house at [point] or for [query]; null when the answer is not an
  /// exact house in Moscow.
  Future<Place?> resolvePlace({String? query, GeoPoint? point}) async {
    assert((query == null) != (point == null), 'one of query and point');
    final found = await _places.run(() => _api.get(
          '/api/story-place',
          _raw,
          query: query != null ? {'q': query} : {'lat': jsNumberToString(point!.lat), 'lon': jsNumberToString(point.lon)},
        ));
    if (!isPlace(found)) return null;
    return Place.fromJson(found).bare;
  }

  /// `POST /api/walk-plan`; the plan is computed without side effects, so transient failures are
  /// retried. Plans are spaced like the server's per-client limit.
  Future<Object?> plan(Map<String, Object?> body) =>
      _plans.run(() => _api.send('POST', '/api/walk-plan', _raw, body: body, idempotent: true));

  Future<StoryJob> storyJob(String id) => _api.get('/api/story-jobs/$id', readStoryJob);

  /// `POST /api/story-jobs`; [idempotencyKey] makes a repeated send return the same job.
  Future<StoryJob> createStoryJob(String address, String idempotencyKey) => _api.send(
        'POST',
        '/api/story-jobs',
        readStoryJob,
        body: {'address': address, 'idempotencyKey': idempotencyKey},
        idempotent: true,
      );

  /// The research job of [ref]: by its ID, or looked up by its request and recovery token.
  Future<Object?> researchJob(ResearchRef ref) {
    final id = ref.id;
    if (id != null) return _api.get('/api/walk-research-jobs/$id', _raw);
    final lookup = researchLookup(ref.request, ref.recoveryToken);
    return _api.get(lookup.path, _raw, query: lookup.query);
  }

  /// `POST /api/walk-research-jobs`; the recovery token makes a repeated send find the same job.
  Future<Object?> createResearch(ResearchRef ref) => _api.send(
        'POST',
        '/api/walk-research-jobs',
        _raw,
        body: {...ref.request.toBody(), 'consent': true, 'recoveryToken': ref.recoveryToken},
        idempotent: true,
      );

  /// `POST /api/walk-research-jobs/{id}/retry`; a repeated retry of one revision is not charged twice.
  Future<Object?> retryResearch(String id, int revision) =>
      _api.send('POST', '/api/walk-research-jobs/$id/retry', _raw, body: {'revision': revision}, idempotent: true);

  Future<AccountWalkRecord> accountWalk(String id) => _api.get('/api/me/walks/$id', AccountWalkRecord.fromJson);

  /// `POST /api/me/walks`; [idempotencyKey] makes a repeated send return the walk created first.
  Future<AccountWalkRecord> createAccountWalk(String title, Map<String, Object?> snapshot, String idempotencyKey) => _api.send(
        'POST',
        '/api/me/walks',
        AccountWalkRecord.fromJson,
        body: {'title': title, 'snapshot': snapshot, 'idempotencyKey': idempotencyKey},
        idempotent: true,
      );

  /// `PATCH /api/me/walks/{id}`; not retried: the revision check would reject a repeat anyway.
  Future<AccountWalkRecord> updateAccountWalk(String id, String title, Map<String, Object?> snapshot, int revision) => _api.send(
        'PATCH',
        '/api/me/walks/$id',
        AccountWalkRecord.fromJson,
        body: {'title': title, 'snapshot': snapshot, 'revision': revision},
      );

  /// `GET /api/parking/near`: parking within [radiusM] of [location].
  Future<List<ParkingPlace>> nearbyParking(GeoPoint location, {int radiusM = 1000}) => _api.get(
        '/api/parking/near',
        parseNearbyParking,
        query: {'lat': jsNumberToString(location.lat), 'lon': jsNumberToString(location.lon), 'radius': '$radiusM'},
      );
}

final builderApiProvider = Provider<BuilderApi>((ref) => BuilderApi(ref.watch(apiProvider)));
