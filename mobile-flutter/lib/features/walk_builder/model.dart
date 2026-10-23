// Port of src/features/walk-builder/model.ts: the builder draft, the planned route,
// research jobs and their fail-closed validators. Raw JSON is validated first with
// the site's rules (field presence matters: an absent key is `undefined` there),
// then parsed into immutable values.
import 'dart:convert';
import 'dart:math' as math;

import '../../walk_engine/car_route.dart';
import '../../walk_engine/cities.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/js_json.dart';
import '../../walk_engine/json_read.dart';

const int maxWalkStops = 40;

/// Mirrors MIN_BUDGET_SHARE in backend/walks.mjs: automatic walks aim for at least this share of the chosen time.
const double minBudgetShare = 0.75;

/// Walking minutes of an automatic walk that fell short of the chosen time, otherwise null.
num? routeShortfall(num walkingMinutes, num minutes) => walkingMinutes < minBudgetShare * minutes ? walkingMinutes : null;

enum TravelMode {
  walking,
  driving;

  static TravelMode parse(Object? value) => value == 'driving' ? driving : walking;
}

enum WalkMode {
  loop,
  open;

  static WalkMode? parse(Object? value) => value == 'loop' ? loop : value == 'open' ? open : null;
}

/// The minutes the builder offers for each way of travel (src/features/travel).
List<int> minutesFor(TravelMode mode) => mode == TravelMode.driving ? const [60, 120, 180] : const [30, 60, 90];

/// Stages of a story or research job (src/features/generator/types.ts).
enum GenerationStage {
  queued('queued', 'Ждём своей очереди'),
  researching('researching', 'Ищем источники'),
  verifying('verifying', 'Проверяем факты'),
  writing('writing', 'Готовим рассказ'),
  voicing('voicing', 'Озвучиваем'),
  ready('ready', 'История готова'),
  insufficientEvidence('insufficient_evidence', 'Не хватило подтверждений'),
  reviewRequired('review_required', 'Нужна проверка редактора'),
  failed('failed', 'Подготовка прервалась');

  const GenerationStage(this.wire, this.label);
  final String wire;

  /// Russian source of the user-facing label.
  final String label;

  bool get terminal => this == ready || this == failed || this == reviewRequired || this == insufficientEvidence;

  static GenerationStage? parse(Object? value) {
    for (final stage in values) {
      if (stage.wire == value) return stage;
    }
    return null;
  }
}

bool isStage(Object? value) => GenerationStage.parse(value) != null;

final _jobId = RegExp(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');
final _osmId = RegExp(r'^osm:(node|way|relation):\d+$');
final _stopId = RegExp(r'^[a-z0-9][a-z0-9-]{0,127}$');
final _forbidden = RegExp(r'[\p{Cc}\p{Cf}<>]', unicode: true);

bool isJobId(Object? id) => id is String && _jobId.hasMatch(id);

typedef Area = bool Function(Object? lat, Object? lon);

/// `isMoscowPoint` of src/features/explore/map-jobs.ts: the builder prepares new walks in Moscow only.
bool isMoscowPoint(Object? lat, Object? lon) =>
    lat is num && lon is num && lat.isFinite && lon.isFinite && lat >= 55.48 && lat <= 55.98 && lon >= 37.3 && lon <= 37.95;

Map<String, Object?>? _record(Object? value) => value is Map<String, Object?> ? value : null;

/// JavaScript truthiness of a decoded JSON value.
bool _truthy(Object? value) => !(value == null || value == false || value == 0 || value == '' || (value is double && value.isNaN));

/// A stop of the builder. contentId: the catalog place whose published story the stop tells;
/// placeId: the catalog place at the stop, story or not.
class Place {
  const Place({required this.address, required this.location, this.contentId, this.placeId, this.stopId, this.parkingId});

  /// Parses a value that [isPlace] (or [isPlaceIn]) accepted.
  factory Place.fromJson(Object? json) {
    final map = readMap(json);
    String? optional(String key) => map[key] as String?;
    return Place(
      address: readString(map['address']),
      location: readPoint(map['location']),
      contentId: optional('contentId'),
      placeId: optional('placeId'),
      stopId: optional('stopId'),
      parkingId: optional('parkingId'),
    );
  }

  final String address;
  final GeoPoint location;
  final String? contentId;
  final String? placeId;
  final String? stopId;
  final String? parkingId;

  Place copyWith({String? parkingId}) => Place(
        address: address,
        location: location,
        contentId: contentId,
        placeId: placeId,
        stopId: stopId,
        parkingId: parkingId ?? this.parkingId,
      );

  /// Address and location only, as the builder keeps a freshly resolved point.
  Place get bare => Place(address: address, location: location);

  Map<String, Object?> toJson() => {
        'address': address,
        'location': location.toJson(),
        if (contentId != null) 'contentId': contentId,
        if (placeId != null) 'placeId': placeId,
        if (stopId != null) 'stopId': stopId,
        if (parkingId != null) 'parkingId': parkingId,
      };

  @override
  bool operator ==(Object other) => other is Place && jsJsonStringify(other.toJson()) == jsJsonStringify(toJson());

  @override
  int get hashCode => jsJsonStringify(toJson()).hashCode;
}

/// A stop of the builder, which prepares new walks in Moscow only.
bool isPlace(Object? value) => isPlaceIn(value, isMoscowPoint);

/// A stop inside [inArea]: a walk of another city is checked against its own city.
bool isPlaceIn(Object? value, Area inArea) {
  final map = _record(value);
  if (map == null) return false;
  final address = map['address'];
  final location = _record(map['location']);
  if (address is! String || address.trim().length < 6 || address.length > 180 || _forbidden.hasMatch(address)) return false;
  if (location == null || location['lat'] is! num || location['lon'] is! num || !inArea(location['lat'], location['lon'])) return false;
  for (final key in const ['contentId', 'placeId', 'parkingId']) {
    if (map.containsKey(key) && !(map[key] is String && _osmId.hasMatch(map[key]! as String))) return false;
  }
  return !map.containsKey('stopId') || (map['stopId'] is String && _stopId.hasMatch(map['stopId']! as String));
}

String placeKey(Place place) =>
    '${place.address.trim().toLowerCase()}|${jsNumberToString(place.location.lat)}|${jsNumberToString(place.location.lon)}';

final _moscowInAddress = RegExp(r'(?:^|[^\p{L}])Москва(?:$|[^\p{L}])', unicode: true, caseSensitive: false);
final _cityPatterns = [
  for (final city in cities) RegExp('(?:^|[^\\p{L}])${city.name}(?:\$|[^\\p{L}])', unicode: true, caseSensitive: false),
];
final _spaces = RegExp(r'\s+');

/// The address key of normalizeAddress + addressKey in backend/domain.mjs (unhashed).
///
/// Divergence: Dart has no Unicode NFKC normalization, so compatibility characters (full-width
/// letters, ligatures) are not folded; whitespace variants are, by `\s`.
String storyAddressKey(String address) {
  final normalized = address.trim().replaceAll(_spaces, ' ');
  final named = _cityPatterns.any((pattern) => pattern.hasMatch(normalized)) || _moscowInAddress.hasMatch(normalized);
  return (named ? normalized : 'Москва, $normalized')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replaceAll(RegExp('[.,]'), ' ')
      .replaceAll(_spaces, ' ')
      .trim();
}

/// A story job the draft remembers for one of its places.
class StoryRef {
  const StoryRef({required this.place, required this.id, required this.stage});

  factory StoryRef.fromJson(Object? json) {
    final map = readMap(json);
    return StoryRef(place: Place.fromJson(map['place']), id: readString(map['id']), stage: GenerationStage.parse(map['stage']) ?? failFormat());
  }

  final Place place;
  final String id;
  final GenerationStage stage;

  StoryRef withStage(GenerationStage stage) => StoryRef(place: place, id: id, stage: stage);

  Map<String, Object?> toJson() => {'place': place.toJson(), 'id': id, 'stage': stage.wire};
}

bool _isStoryRef(Object? value) {
  final map = _record(value);
  return map != null && isPlace(map['place']) && isJobId(map['id']) && isStage(map['stage']);
}

/// `rememberStory`: the job replaces an older entry with the same id and moves to the end.
List<StoryRef> rememberStory(List<StoryRef> jobs, StoryRef job) => [...jobs.where((item) => item.id != job.id), job];

int manualStopLimit(Place? start, [List<StoryRef> jobs = const []]) {
  final hasStartStory = start != null && jobs.any((job) => placeKey(job.place) == placeKey(start) && isJobId(job.id));
  return maxWalkStops - (hasStartStory ? 1 : 0);
}

/// Whether [stops] (and the [destination]) make a walk from [start]: valid Moscow places,
/// 1..limit stops (0 with a destination), every point at least 5 m from the previous ones;
/// as on the server, the first stop may be the start building itself.
bool validStops(Place? start, List<Place> stops, [Place? destination, List<StoryRef> jobs = const []]) {
  if (start == null || !isPlace(start.toJson()) || stops.length < (destination != null ? 0 : 1) || stops.length > manualStopLimit(start, jobs)) {
    return false;
  }
  if (!stops.every((stop) => isPlace(stop.toJson()))) return false;
  if (destination != null && !isPlace(destination.toJson())) return false;
  final points = [start, ...stops, ?destination];
  const rad = math.pi / 180;
  for (var i = 0; i < points.length; i++) {
    for (var j = 0; j < i; j++) {
      if (stops.isNotEmpty && i == 1 && j == 0) continue;
      final p = points[i].location, q = points[j].location;
      final h = math.pow(math.sin((p.lat - q.lat) * rad / 2), 2) +
          math.cos(p.lat * rad) * math.cos(q.lat * rad) * math.pow(math.sin((p.lon - q.lon) * rad / 2), 2);
      if (12742000 * math.asin(math.sqrt(math.min(1, h))) < 5) return false;
    }
  }
  return true;
}

/// `validTunnels` of backend/walk-document.mjs: covered stretches as sorted [a, b] vertex ranges.
bool validTunnels(Map<String, Object?> owner, int geometryLength) {
  if (!owner.containsKey('tunnels')) return true;
  final value = owner['tunnels'];
  if (value is! List<Object?> || value.length > 500) return false;
  var previous = -1;
  for (final pair in value) {
    if (pair is! List<Object?> || pair.length != 2) return false;
    final a = pair[0], b = pair[1];
    if (!jsIsSafeInteger(a) || !jsIsSafeInteger(b)) return false;
    final first = (a! as num).toInt(), last = (b! as num).toInt();
    if (first <= previous || first < 0 || last <= first || last > geometryLength - 1) return false;
    previous = last;
  }
  return true;
}

/// One `[a, b]` pair of a route's `tunnels` that [validTunnels] accepted.
(int, int) readTunnel(Object? pair) {
  final list = readList(pair);
  return (readInt(list[0]), readInt(list[1]));
}

/// A built route: walking, or a car route with parking visits ([car]).
class Plan {
  Plan({
    required List<Place> stops,
    required List<GeoPoint> geometry,
    required this.distanceM,
    required this.walkingMinutes,
    required this.attribution,
    this.tunnels,
    this.car,
  })  : stops = List.unmodifiable(stops),
        geometry = List.unmodifiable(geometry);

  /// Parses a value that [isPlan] accepted.
  factory Plan.fromJson(Object? json) {
    final map = readMap(json);
    final tunnels = map['tunnels'];
    return Plan(
      stops: readList(map['stops']).map(Place.fromJson).toList(),
      geometry: readList(map['geometry']).map(readPoint).toList(),
      distanceM: map['distanceM']! as num,
      walkingMinutes: map['walkingMinutes']! as num,
      attribution: readString(map['attribution']),
      tunnels: tunnels == null
          ? null
          : readList(tunnels).map(readTunnel).toList(),
      car: map['car'] == null ? null : CarRoute.fromJson(map['car']),
    );
  }

  final List<Place> stops;
  final List<GeoPoint> geometry;
  final num distanceM;
  final num walkingMinutes;
  final String attribution;
  final List<(int, int)>? tunnels;
  final CarRoute? car;

  /// The time the route takes: the whole car trip, or the walk.
  num get totalMinutes => car?.totalMinutes ?? walkingMinutes;

  Plan withStops(List<Place> stops) =>
      Plan(stops: stops, geometry: geometry, distanceM: distanceM, walkingMinutes: walkingMinutes, attribution: attribution, tunnels: tunnels, car: car);

  Map<String, Object?> toJson() => {
        'stops': [for (final stop in stops) stop.toJson()],
        'geometry': [for (final point in geometry) point.toJson()],
        'distanceM': distanceM,
        'walkingMinutes': walkingMinutes,
        'attribution': attribution,
        if (tunnels != null) 'tunnels': [for (final (a, b) in tunnels!) [a, b]],
        if (car != null) 'car': car!.toJson(),
      };
}

bool isPlan(Object? value) => isPlanIn(value, isMoscowPoint);

bool isPlanIn(Object? value, Area inArea) {
  final map = _record(value);
  if (map == null) return false;
  final car = _truthy(map['car']);
  final stops = map['stops'], geometry = map['geometry'], distance = map['distanceM'], minutes = map['walkingMinutes'], attribution = map['attribution'];
  if (stops is! List<Object?> || stops.length > maxWalkStops || !stops.every((stop) => isPlaceIn(stop, inArea))) return false;
  if (geometry is! List<Object?> || geometry.length < 2 || geometry.length > (car ? 30000 : 12000)) return false;
  for (final point in geometry) {
    final p = _record(point);
    if (p == null || p['lat'] is! num || p['lon'] is! num || !inArea(p['lat'], p['lon'])) return false;
  }
  if (distance is! num || !distance.isFinite || distance <= 0 || distance > (car ? 250000 : 8100)) return false;
  if (minutes is! num || !minutes.isFinite || minutes < (car ? 0 : 1) || minutes > (car ? 180 : 90)) return false;
  if (attribution is! String || attribution.isEmpty || attribution.length > 2000 || !validTunnels(map, geometry.length)) return false;
  if (!map.containsKey('car')) return true;
  final stopIds = [for (final stop in stops) (stop! as Map<String, Object?>)['stopId']].whereType<String>().toList();
  return stopIds.length == stops.length && validCarRoute(map['car'], stopIds, (point) => inArea(point['lat'], point['lon']));
}

/// The parameters a research job explores.
class ResearchRequest {
  const ResearchRequest({required this.start, this.destination, required this.mode, required this.minutes});

  factory ResearchRequest.fromJson(Object? json) {
    final map = readMap(json);
    return ResearchRequest(
      start: Place.fromJson(map['start']),
      destination: map['destination'] == null ? null : Place.fromJson(map['destination']),
      mode: WalkMode.parse(map['mode']) ?? failFormat(),
      minutes: readInt(map['minutes']),
    );
  }

  final Place start;
  final Place? destination;
  final WalkMode mode;
  final int minutes;

  /// The stored form keeps `destination` (null when absent), as the site's snapshot does.
  Map<String, Object?> toJson() => {'start': start.toJson(), 'destination': destination?.toJson(), 'mode': mode.name, 'minutes': minutes};

  /// The POST body: `destination` only when there is one.
  Map<String, Object?> toBody() => {'start': start.toJson(), 'destination': ?destination?.toJson(), 'mode': mode.name, 'minutes': minutes};
}

bool isResearchRequest(Object? value) {
  final map = _record(value);
  return map != null &&
      isPlace(map['start']) &&
      (map['destination'] == null || (map['mode'] == 'open' && isPlace(map['destination']))) &&
      WalkMode.parse(map['mode']) != null &&
      (map['minutes'] == 30 || map['minutes'] == 60 || map['minutes'] == 90);
}

/// What the draft remembers about a research request: its id once known, the stops it was
/// started for, and the recovery token that finds an uncertain send again.
class ResearchRef {
  ResearchRef({required this.request, required this.id, required List<Place> stops, required this.recoveryToken}) : stops = List.unmodifiable(stops);

  factory ResearchRef.fromJson(Object? json) {
    final map = readMap(json);
    return ResearchRef(
      request: ResearchRequest.fromJson(map['request']),
      id: map['id'] as String?,
      stops: readList(map['stops']).map(Place.fromJson).toList(),
      recoveryToken: readString(map['recoveryToken']),
    );
  }

  final ResearchRequest request;
  final String? id;
  final List<Place> stops;
  final String recoveryToken;

  ResearchRef withId(String id) => ResearchRef(request: request, id: id, stops: stops, recoveryToken: recoveryToken);

  Map<String, Object?> toJson() => {
        'request': request.toJson(),
        'id': id,
        'stops': [for (final stop in stops) stop.toJson()],
        'recoveryToken': recoveryToken,
      };
}

double _fixed6(double value) => double.parse(value.toStringAsFixed(6));

/// The server key deliberately excludes the address label.
String researchKey(ResearchRequest request) => jsJsonStringify([
      _fixed6(request.start.location.lat),
      _fixed6(request.start.location.lon),
      request.mode.name,
      request.minutes,
      if (request.destination != null) ...[_fixed6(request.destination!.location.lat), _fixed6(request.destination!.location.lon)],
    ]);

/// `GET /api/walk-research-jobs?…` that finds the job of an uncertain send by its recovery token.
({String path, Map<String, String> query}) researchLookup(ResearchRequest request, String recoveryToken) => (
      path: '/api/walk-research-jobs',
      query: {
        'lat': jsNumberToString(_fixed6(request.start.location.lat)),
        'lon': jsNumberToString(_fixed6(request.start.location.lon)),
        'mode': request.mode.name,
        'minutes': '${request.minutes}',
        if (request.destination != null) ...{
          'destinationLat': jsNumberToString(request.destination!.location.lat),
          'destinationLon': jsNumberToString(request.destination!.location.lon),
        },
        'recoveryToken': recoveryToken,
      },
    );

enum ResearchPhase {
  discovery('Ищем адреса поблизости'),
  research('Проверяем источники об адресах'),
  routing('Соединяем подтверждённые остановки'),
  narration('Готовим тексты и аудио'),
  complete('Прогулка готова');

  const ResearchPhase(this.label);
  final String label;

  static ResearchPhase? parse(Object? value) => values.where((phase) => phase.name == value).firstOrNull;
}

/// The error a job reports; its message is a Russian source.
typedef JobError = ({String code, String message});

class ResearchJob {
  ResearchJob({
    required this.id,
    required this.stage,
    required this.revision,
    required this.request,
    required this.phase,
    required this.progress,
    required this.route,
    required List<StoryRef> stories,
    required this.error,
    required this.canRetry,
  }) : stories = List.unmodifiable(stories);

  final String id;
  final GenerationStage stage;
  final int revision;
  final ResearchRequest request;
  final ResearchPhase phase;
  final ({int checked, int total, int accepted}) progress;
  final Plan? route;
  final List<StoryRef> stories;
  final JobError? error;
  final bool canRetry;
}

class ModelError implements Exception {
  const ModelError(this.message);

  /// Russian source text.
  final String message;

  @override
  String toString() => 'ModelError: $message';
}

bool _progressValue(Object? value) => jsIsInteger(value) && (value! as num) >= 0 && (value as num) <= 3;

/// `readResearchJob`: a research job answer, checked against the [expected] reference.
ResearchJob readResearchJob(Object? value, [ResearchRef? expected]) {
  const unreadable = ModelError('Не удалось прочитать состояние исследования.');
  final map = _record(value);
  if (map == null || !isJobId(map['id']) || !isStage(map['stage']) || !jsIsSafeInteger(map['revision']) || (map['revision']! as num) < 0) throw unreadable;
  if (!isResearchRequest(map['request']) || ResearchPhase.parse(map['phase']) == null) throw unreadable;
  final progress = _record(map['progress']);
  if (progress == null || ![progress['checked'], progress['total'], progress['accepted']].every(_progressValue)) throw unreadable;
  final checked = (progress['checked']! as num).toInt(), total = (progress['total']! as num).toInt(), accepted = (progress['accepted']! as num).toInt();
  if (checked > total || accepted > checked) throw unreadable;
  final request = ResearchRequest.fromJson(map['request']);
  final route = map['route'];
  if (route != null || !map.containsKey('route')) {
    if (!isPlan(route)) throw unreadable;
    final plan = Plan.fromJson(route);
    if (!validStops(request.start, plan.stops, request.destination) || plan.walkingMinutes > request.minutes) throw unreadable;
  }
  final stories = map['stories'];
  if (stories is! List<Object?> || stories.length > 3 || !stories.every(_isStoryRef)) throw unreadable;
  final error = map['error'];
  if (error != null || !map.containsKey('error')) {
    final fields = _record(error);
    if (fields == null || fields['code'] is! String || fields['message'] is! String) throw unreadable;
  }
  if (map['canRetry'] is! bool) throw unreadable;
  final errorFields = _record(error);
  final job = ResearchJob(
    id: map['id']! as String,
    stage: GenerationStage.parse(map['stage'])!,
    revision: (map['revision']! as num).toInt(),
    request: request,
    phase: ResearchPhase.parse(map['phase'])!,
    progress: (checked: checked, total: total, accepted: accepted),
    route: route == null ? null : Plan.fromJson(route),
    stories: stories.map(StoryRef.fromJson).toList(),
    error: errorFields == null ? null : (code: errorFields['code']! as String, message: errorFields['message']! as String),
    canRetry: map['canRetry']! as bool,
  );
  if (expected != null && (researchKey(job.request) != researchKey(expected.request) || (expected.id != null && job.id != expected.id))) {
    throw const ModelError('Сервис вернул другое исследование.');
  }
  return job;
}

/// The value the fixture compares: [readResearchJob] keeps the accepted document as it is.
Map<String, Object?> researchJobJson(ResearchJob job) => {
      'id': job.id,
      'stage': job.stage.wire,
      'revision': job.revision,
      'request': job.request.toJson(),
      'phase': job.phase.name,
      'progress': {'checked': job.progress.checked, 'total': job.progress.total, 'accepted': job.progress.accepted},
      'route': job.route?.toJson(),
      'stories': [for (final story in job.stories) story.toJson()],
      'error': job.error == null ? null : {'code': job.error!.code, 'message': job.error!.message},
      'canRetry': job.canRetry,
    };

/// A replacement for a nullable field in [Draft.copyWith]: `Value(null)` clears it.
class Value<T> {
  const Value(this.value);
  final T value;
}

/// The builder state that survives restarts (site `otgolosok:walk:v1`).
class Draft {
  Draft({
    required this.title,
    required this.start,
    this.destination,
    required this.mode,
    required this.travelMode,
    required this.minutes,
    required List<Place> stops,
    required this.route,
    required List<StoryRef> jobs,
    required this.submitting,
    this.research,
    this.researchApplied,
  })  : stops = List.unmodifiable(stops),
        jobs = List.unmodifiable(jobs);

  factory Draft.empty([TravelMode travelMode = TravelMode.walking]) => Draft(
        title: 'Моя прогулка',
        start: null,
        mode: WalkMode.loop,
        travelMode: travelMode,
        minutes: travelMode == TravelMode.driving ? 60 : 30,
        stops: const [],
        route: null,
        jobs: const [],
        submitting: null,
      );

  final String title;
  final Place? start;
  final Place? destination;
  final WalkMode mode;
  final TravelMode travelMode;
  final int minutes;
  final List<Place> stops;
  final Plan? route;
  final List<StoryRef> jobs;

  /// The place of a story job whose POST may have been sent: the result is unknown.
  final Place? submitting;
  final ResearchRef? research;
  final bool? researchApplied;

  bool get driving => travelMode == TravelMode.driving;

  Draft copyWith({
    String? title,
    Value<Place?>? start,
    Value<Place?>? destination,
    WalkMode? mode,
    TravelMode? travelMode,
    int? minutes,
    List<Place>? stops,
    Value<Plan?>? route,
    List<StoryRef>? jobs,
    Value<Place?>? submitting,
    Value<ResearchRef?>? research,
    Value<bool?>? researchApplied,
  }) =>
      Draft(
        title: title ?? this.title,
        start: start == null ? this.start : start.value,
        destination: destination == null ? this.destination : destination.value,
        mode: mode ?? this.mode,
        travelMode: travelMode ?? this.travelMode,
        minutes: minutes ?? this.minutes,
        stops: stops ?? this.stops,
        route: route == null ? this.route : route.value,
        jobs: jobs ?? this.jobs,
        submitting: submitting == null ? this.submitting : submitting.value,
        research: research == null ? this.research : research.value,
        researchApplied: researchApplied == null ? this.researchApplied : researchApplied.value,
      );

  Map<String, Object?> toJson() => {
        'version': 1,
        'title': title,
        'start': start?.toJson(),
        if (destination != null) 'destination': destination!.toJson(),
        'mode': mode.name,
        'travelMode': travelMode.name,
        'minutes': minutes,
        'stops': [for (final stop in stops) stop.toJson()],
        'route': route?.toJson(),
        'jobs': [for (final job in jobs) job.toJson()],
        'submitting': submitting?.toJson(),
        if (research != null) 'research': research!.toJson(),
        if (researchApplied != null) 'researchApplied': researchApplied,
      };

  String encode() => jsonEncode(toJson());
}

bool researchMatches(Draft draft, ResearchRef ref) {
  final start = draft.start;
  if (start == null || !(draft.minutes == 30 || draft.minutes == 60 || draft.minutes == 90)) return false;
  final request = ResearchRequest(start: start, destination: draft.destination, mode: draft.mode, minutes: draft.minutes);
  return researchKey(request) == researchKey(ref.request) &&
      jsJsonStringify([for (final stop in draft.stops) stop.toJson()]) == jsJsonStringify([for (final stop in ref.stops) stop.toJson()]);
}

Draft applyResearch(Draft draft, ResearchJob job) {
  final research = draft.research;
  final route = job.route;
  if (research == null ||
      research.id != job.id ||
      !researchMatches(draft, research) ||
      researchKey(job.request) != researchKey(research.request) ||
      job.stage != GenerationStage.ready ||
      job.phase != ResearchPhase.complete ||
      route == null ||
      !route.stops.every((stop) => job.stories.any((story) => placeKey(story.place) == placeKey(stop) && story.stage == GenerationStage.ready))) {
    throw const ModelError('Исследование не соответствует текущей прогулке или ещё не завершено.');
  }
  return draft.copyWith(stops: route.stops, route: Value(route), jobs: job.stories.fold<List<StoryRef>>(draft.jobs, rememberStory), researchApplied: const Value(true));
}

/// `parseDraft`: a stored draft, or the empty one for null. Throws [ModelError] or [FormatException];
/// the caller never overwrites a stored copy it could not read.
Draft parseDraft(String? raw) {
  if (raw == null) return Draft.empty();
  return draftFromJson(jsonDecode(raw));
}

/// [parseDraft] of an already decoded value (a legacy account snapshot).
Draft draftFromJson(Object? value) {
  const unreadable = ModelError('Черновик не удалось прочитать. Исходная копия не изменена.');
  final v = _record(value);
  if (v == null) throw unreadable;
  final travelMode = TravelMode.parse(v['travelMode']);
  final validMinutes = minutesFor(travelMode);
  final jobs = v['jobs'], stops = v['stops'], title = v['title'], minutes = v['minutes'];
  if (v['version'] != 1 ||
      (v.containsKey('travelMode') && v['travelMode'] != 'walking' && v['travelMode'] != 'driving') ||
      title is! String ||
      title.length > 120 ||
      (v['start'] != null || !v.containsKey('start')) && !isPlace(v['start']) ||
      WalkMode.parse(v['mode']) == null ||
      minutes is! num ||
      !validMinutes.contains(minutes) ||
      stops is! List<Object?> ||
      stops.length > maxWalkStops ||
      !stops.every(isPlace) ||
      jobs is! List<Object?> ||
      jobs.length > 100 ||
      !jobs.every(_isStoryRef) ||
      (v['submitting'] != null || !v.containsKey('submitting')) && !isPlace(v['submitting'])) {
    throw unreadable;
  }
  if (v['destination'] != null && (v['mode'] != 'open' || !isPlace(v['destination']))) throw const ModelError('Некорректный финиш прогулки.');
  final start = v['start'] == null ? null : Place.fromJson(v['start']);
  final destination = v['destination'] == null ? null : Place.fromJson(v['destination']);
  final places = stops.map(Place.fromJson).toList();
  final route = v['route'];
  Plan? plan;
  if (route != null || !v.containsKey('route')) {
    const corrupt = ModelError('Сохранённый маршрут повреждён. Исходная копия не изменена.');
    if (!isPlan(route)) throw corrupt;
    final routeMap = route! as Map<String, Object?>;
    plan = Plan.fromJson(route);
    if ((plan.car != null) != (travelMode == TravelMode.driving) ||
        !validStops(start, places, destination) ||
        jsJsonStringify(routeMap['stops']) != jsJsonStringify(stops) ||
        plan.totalMinutes > minutes) {
      throw corrupt;
    }
  }
  final research = v['research'];
  if (v.containsKey('research')) {
    final ref = _record(research);
    final refStops = ref?['stops'];
    if (travelMode != TravelMode.walking ||
        ref == null ||
        !isJobId(ref['recoveryToken']) ||
        !isResearchRequest(ref['request']) ||
        (ref['id'] != null || !ref.containsKey('id')) && !isJobId(ref['id']) ||
        refStops is! List<Object?> ||
        refStops.length > maxWalkStops ||
        !refStops.every(isPlace)) {
      throw const ModelError('Сохранённое исследование повреждено. Исходная копия не изменена.');
    }
  }
  if (v.containsKey('researchApplied') && v['researchApplied'] is! bool) {
    throw const ModelError('Сохранённое исследование повреждено. Исходная копия не изменена.');
  }
  // Older drafts could contain the same backend job for multiple map points.
  return Draft(
    title: title,
    start: start,
    destination: destination,
    mode: WalkMode.parse(v['mode'])!,
    travelMode: travelMode,
    minutes: minutes.toInt(),
    stops: places,
    route: plan,
    jobs: jobs.map(StoryRef.fromJson).fold<List<StoryRef>>(const [], rememberStory),
    submitting: v['submitting'] == null ? null : Place.fromJson(v['submitting']),
    research: research == null ? null : ResearchRef.fromJson(research),
    researchApplied: v['researchApplied'] as bool?,
  );
}

/// What the builder form may change; every change drops the built route.
class DraftChange {
  const DraftChange({this.start, this.destination, this.mode, this.minutes, this.stops, this.travelMode});

  final Value<Place?>? start;
  final Value<Place?>? destination;
  final WalkMode? mode;
  final int? minutes;
  final List<Place>? stops;
  final TravelMode? travelMode;

  /// A change of the endpoints or parameters returns the stop selection to automatic.
  bool get parameters => start != null || destination != null || mode != null || minutes != null || travelMode != null;
}

Draft editDraft(Draft draft, DraftChange change) => draft.copyWith(
      start: change.start,
      destination: change.destination,
      mode: change.mode,
      minutes: change.minutes,
      stops: change.stops,
      travelMode: change.travelMode,
      route: const Value(null),
      researchApplied: draft.researchApplied == true ? const Value(false) : null,
    );

/// Only a real shortage of catalog stops is fixed by researching more places; an unroutable walk is not.
bool shouldOfferResearch(bool automatic, String? errorCode) => automatic && errorCode == 'WALK_STOPS_NOT_FOUND';
