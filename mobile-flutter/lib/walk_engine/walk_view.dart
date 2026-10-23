// Walk documents and public walk views: the wire contract of
// backend/walk-document.mjs (validateWalkDocument, validateWalkView), with the
// car route rules of backend/car-route.mjs and the city bounds of
// backend/cities.json. `fromJson` validates first and throws FormatException
// on anything the site's validator rejects.
//
// Deliberately stricter than the JavaScript: identifiers must be strings. The
// site tests ids with `RegExp.test`, which coerces non-strings, so a missing id
// ("undefined") or `["a"]` passes there; a typed model cannot represent that.
import 'car_route.dart';
import 'cities.dart';
import 'distance.dart';
import 'js_json.dart';
import 'json_read.dart';

export 'car_route.dart';

const int maxWalkStops = 40;
const int maxRouteTunnels = 500;

// ---- Raw validation --------------------------------------------------------

final RegExp _forbidden = RegExp(r'[\p{Cc}\p{Cf}<>]', unicode: true);
final RegExp _slug = RegExp(r'^[a-z0-9][a-z0-9-]{0,127}$');
final RegExp _uuidPattern = RegExp(
  r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
  caseSensitive: false,
);
final RegExp _osmId = RegExp(r'^osm:(node|way|relation):\d+$');
final RegExp _storyUrl = RegExp(r'^https:\/\/[^\s<>]+$', caseSensitive: false);
final RegExp _audioUrl = RegExp(
  r'^\/(?:audio\/walk\/[a-zA-Z0-9-]+\.mp3|api\/story-audio\/[a-f0-9]{64}\.mp3)$',
);
final RegExp _sha256 = RegExp(r'^[a-f0-9]{64}$');
final RegExp _date = RegExp(r'^\d{4}-\d{2}-\d{2}$');

const Set<String> _locales = {'ru', 'en', 'zh'};
const Set<String> _fallbackReasons = {'missing', 'draft', 'stale'};
const Set<String> _statuses = {
  'not_requested',
  'preparing',
  'text_ready',
  'ready',
  'failed',
  'review_required',
  'insufficient_evidence',
  'unavailable',
};

// JavaScript's String.prototype.trim and Dart's trim differ only on U+0085,
// a control character the forbidden-character test rejects anyway.
bool _string(Object? value, int limit, [bool empty = false]) =>
    value is String &&
    value.length <= limit &&
    (empty || value.trim().isNotEmpty) &&
    !_forbidden.hasMatch(value);

bool _uuid(Object? value) => value is String && _uuidPattern.hasMatch(value);

bool _walkId(Object? value) =>
    _uuid(value) || (value is String && _slug.hasMatch(value));

/// Coordinates a walk may use: inside a covered city.
bool inWalkBounds(Object? lat, Object? lon) => cityAt(lat, lon) != null;

Map<String, Object?> _map(Object? value) => value! as Map<String, Object?>;

bool _point(Object? value) =>
    jsFields(value, const ['lat', 'lon']) &&
    inWalkBounds(_map(value)['lat'], _map(value)['lon']);

bool _place(Object? value) =>
    jsFields(value, const ['address', 'location']) &&
    _string(_map(value)['address'], 180) &&
    _point(_map(value)['location']);

/// `value === null || <check>`: present and null, or valid.
bool _nullOr(Map<String, Object?> map, String key, bool Function(Object?) check) =>
    map.containsKey(key) && (map[key] == null || check(map[key]));

bool _reference(Object? value) {
  if (!jsFields(value, const ['kind', 'id'])) return false;
  final map = _map(value);
  final kind = map['kind'];
  final id = map['id'];
  return (kind == 'job' && _uuid(id)) ||
      (kind == 'osm' && id is String && _osmId.hasMatch(id)) ||
      (kind == 'catalog' && id is String && _slug.hasMatch(id));
}

bool _stop(Object? value) {
  if (!jsFields(value, const [
    'id',
    'place',
    'storyRef',
    'placeId',
    'transition',
    'nextHint',
    'triggerLocation',
  ])) {
    return false;
  }
  final map = _map(value);
  final placeId = map['placeId'];
  return _walkId(map['id']) &&
      _place(map['place']) &&
      _nullOr(map, 'storyRef', _reference) &&
      (!map.containsKey('placeId') ||
          (placeId is String && _osmId.hasMatch(placeId))) &&
      _string(map['transition'], 1200, true) &&
      _string(map['nextHint'], 1200, true) &&
      (!map.containsKey('triggerLocation') || _point(map['triggerLocation']));
}

/// Covered stretches of a route as vertex index ranges of its geometry. Absent
/// is valid; pairs are sorted and separated by at least one segment.
bool validTunnels(Map<String, Object?> route, int geometryLength) {
  if (!route.containsKey('tunnels')) return true;
  final value = route['tunnels'];
  if (value is! List<Object?> || value.length > maxRouteTunnels) return false;
  num previous = -1;
  for (final pair in value) {
    if (pair is! List<Object?> || pair.length != 2) return false;
    final a = pair[0];
    final b = pair[1];
    if (!jsIsSafeInteger(a) || !jsIsSafeInteger(b)) return false;
    final start = a! as num;
    final end = b! as num;
    if (start <= previous || start < 0 || end <= start || end > geometryLength - 1) {
      return false;
    }
    previous = end;
  }
  return true;
}

bool _finite(Object? value) => value is num && value.isFinite;

bool _route(Map<String, Object?> document) {
  if (!document.containsKey('route')) return false;
  final value = document['route'];
  if (value == null) return true;
  final driving = document['travelMode'] == 'driving';
  if (!jsFields(value, [
    'geometry',
    'distanceM',
    'walkingMinutes',
    'attribution',
    'tunnels',
    if (driving) 'car',
  ])) {
    return false;
  }
  final route = _map(value);
  final geometry = route['geometry'];
  if (geometry is! List<Object?> ||
      geometry.length < 2 ||
      geometry.length > (driving ? maxCarVertices : 12000) ||
      !geometry.every(_point) ||
      !validTunnels(route, geometry.length) ||
      !_finite(route['distanceM']) ||
      !_finite(route['walkingMinutes'])) {
    return false;
  }
  final distanceM = route['distanceM']! as num;
  final walkingMinutes = route['walkingMinutes']! as num;
  if (distanceM <= 0 ||
      distanceM > (driving ? maxCarDistanceM : 8100) ||
      walkingMinutes < (driving ? 0 : 1) ||
      walkingMinutes > (driving ? 180 : 90) ||
      !_string(route['attribution'], 2000)) {
    return false;
  }
  if (!driving) return true;
  final city = cityByName(document['city']);
  final car = route['car'];
  final stopIds = [
    for (final stop in document['stops']! as List<Object?>) _map(stop)['id'],
  ];
  if (!validCarRoute(
        car,
        stopIds,
        (point) => cityAt(point['lat'], point['lon']) == city,
      ) ||
      (_map(car)['totalMinutes']! as num) > (document['minutes']! as num)) {
    return false;
  }
  final segments = [
    for (final segment in _map(car)['segments']! as List<Object?>) _map(segment),
  ];
  num meters = 0;
  num walking = 0;
  for (final segment in segments) {
    meters += segment['distanceM']! as num;
    if (segment['mode'] == 'walking') walking += segment['minutes']! as num;
  }
  return (distanceM - meters).abs() <= segments.length &&
      walkingMinutes == walking.ceil() &&
      jsJsonStringify(geometry) == rawCarRouteGeometryJson(_map(car));
}

/// Every coordinate of a walk lies in the city it names: a route never leaves its city.
bool _inOneCity(Map<String, Object?> document) {
  final city = cityByName(document['city']);
  final points = <Object?>[
    if (document['start'] != null) _map(document['start'])['location'],
    if (document['destination'] != null) _map(document['destination'])['location'],
    for (final stop in document['stops']! as List<Object?>) ...[
      _map(_map(stop)['place'])['location'],
      if (_map(stop).containsKey('triggerLocation')) _map(stop)['triggerLocation'],
    ],
    if (document['route'] != null) ..._map(document['route'])['geometry']! as List<Object?>,
  ];
  return points.every((point) {
    final map = _map(point);
    return cityAt(map['lat'], map['lon']) == city;
  });
}

/// validateWalkDocument of backend/walk-document.mjs on a decoded JSON value.
void validateWalkDocumentJson(Object? value) {
  bool valid() {
    if (!jsFields(value, const [
      'version',
      'id',
      'title',
      'description',
      'city',
      'mode',
      'minutes',
      'start',
      'destination',
      'stops',
      'route',
      'fieldChecked',
      'travelMode',
    ])) {
      return false;
    }
    final document = _map(value);
    final travelMode = document['travelMode'];
    final driving = travelMode == 'driving';
    final stops = document['stops'];
    final startNull = document.containsKey('start') && document['start'] == null;
    if (document['version'] != 2 ||
        !_walkId(document['id']) ||
        !_string(document['title'], 120) ||
        !_string(document['description'], 1000, true) ||
        cityByName(document['city']) == null ||
        (document['mode'] != 'open' && document['mode'] != 'loop') ||
        (document.containsKey('travelMode') &&
            travelMode != 'walking' &&
            travelMode != 'driving') ||
        !(driving ? carMinutes : const [15, 30, 60, 90]).contains(document['minutes']) ||
        !(startNull || _place(document['start'])) ||
        (document['destination'] != null &&
            (document['mode'] != 'open' || !_place(document['destination']))) ||
        stops is! List<Object?> ||
        stops.length > maxWalkStops ||
        !stops.every(_stop) ||
        (startNull && stops.isNotEmpty) ||
        stops.map((stop) => _map(stop)['id']).toSet().length != stops.length ||
        !_route(document) ||
        (document['route'] != null &&
            (startNull || (stops.isEmpty && document['destination'] == null))) ||
        document['fieldChecked'] is! bool ||
        jsJsonStringify(document).length >
            (driving ? maxCarDocumentBytes : 100000) ||
        !_inOneCity(document)) {
      return false;
    }
    return true;
  }

  if (!_guard(valid)) failFormat();
}

/// The parts of a document a translation may not change, as canonical JSON text.
String _immutableDocument(Map<String, Object?> document) {
  final copy = Map<String, Object?>.of(document)
    ..['title'] = ''
    ..['description'] = ''
    ..['stops'] = [
      for (final stop in document['stops']! as List<Object?>)
        Map<String, Object?>.of(_map(stop))
          ..['transition'] = ''
          ..['nextHint'] = '',
    ];
  return jsJsonStringify(_canonical(copy));
}

Object? _canonical(Object? value) {
  if (value is List<Object?>) return [for (final item in value) _canonical(item)];
  if (value is Map<String, Object?>) {
    final keys = value.keys.toList()..sort();
    return {for (final key in keys) key: _canonical(value[key])};
  }
  return value;
}

bool _localization(Object? value) {
  if (!jsFields(value, const ['requestedLocale', 'contentLocale', 'fallbackReason'])) {
    return false;
  }
  final map = _map(value);
  final requested = map['requestedLocale'];
  final content = map['contentLocale'];
  final reason = map['fallbackReason'];
  final reasonNull = map.containsKey('fallbackReason') && reason == null;
  if (!_locales.contains(requested) ||
      !_locales.contains(content) ||
      !(reasonNull || _fallbackReasons.contains(reason))) {
    return false;
  }
  return requested == content ? reasonNull : content == 'ru' && !reasonNull;
}

bool _storyValue(Object? value) {
  if (!jsFields(value, const [
    'title',
    'address',
    'paragraphs',
    'sources',
    'facts',
    'checkedAt',
  ])) {
    return false;
  }
  final story = _map(value);
  final paragraphs = story['paragraphs'];
  final sources = story['sources'];
  final facts = story['facts'];
  bool ids(Object? list) =>
      list is List<Object?> &&
      list.length <= 100 &&
      list.every((id) => _string(id, 128));
  return _string(story['title'], 180) &&
      _string(story['address'], 180) &&
      paragraphs is List<Object?> &&
      paragraphs.isNotEmpty &&
      paragraphs.length <= 100 &&
      paragraphs.every(
        (item) =>
            jsFields(item, const ['text', 'factIds']) &&
            _string(_map(item)['text'], 6000) &&
            ids(_map(item)['factIds']),
      ) &&
      sources is List<Object?> &&
      sources.length <= 100 &&
      sources.every((item) {
        if (!jsFields(item, const ['id', 'title', 'url', 'publisher'])) return false;
        final source = _map(item);
        final url = source['url'];
        return _string(source['id'], 128) &&
            _string(source['title'], 500) &&
            url is String &&
            url.length <= 2000 &&
            _storyUrl.hasMatch(url) &&
            _string(source['publisher'], 500, true);
      }) &&
      facts is List<Object?> &&
      facts.length <= 100 &&
      facts.every(
        (item) =>
            jsFields(item, const ['id', 'claim', 'sourceIds']) &&
            _string(_map(item)['id'], 128) &&
            _string(_map(item)['claim'], 2000) &&
            ids(_map(item)['sourceIds']),
      ) &&
      (!story.containsKey('checkedAt') ||
          (story['checkedAt'] is String &&
              _date.hasMatch(story['checkedAt']! as String)));
}

bool _audioValue(Object? value) {
  if (!jsFields(value, const ['url', 'sha256', 'durationSec', 'language'])) {
    return false;
  }
  final audio = _map(value);
  final url = audio['url'];
  final sha = audio['sha256'];
  final duration = audio['durationSec'];
  return url is String &&
      _audioUrl.hasMatch(url) &&
      sha is String &&
      _sha256.hasMatch(sha) &&
      duration is num &&
      duration.isFinite &&
      duration > 0 &&
      duration <= 7200 &&
      (!audio.containsKey('language') || _locales.contains(audio['language']));
}

/// validateWalkView of backend/walk-document.mjs on a decoded JSON value.
void validateWalkViewJson(Object? value) {
  bool valid() {
    final view = value is Map<String, Object?> ? value : const <String, Object?>{};
    validateWalkDocumentJson(view['document']);
    final document = _map(view['document']);
    final hasSource = view.containsKey('sourceDocument');
    if (hasSource) validateWalkDocumentJson(view['sourceDocument']);
    final requestedLocale = view['requestedLocale'] ?? 'ru';
    if (!jsFields(value, const [
      'document',
      'sourceDocument',
      'documentLocalization',
      'revision',
      'contentVersion',
      'requestedLocale',
      'chapters',
    ])) {
      return false;
    }
    final revision = view['revision'];
    if (!_locales.contains(requestedLocale) ||
        !jsIsSafeInteger(revision) ||
        (revision! as num) < 0 ||
        !_string(view['contentVersion'], 120)) {
      return false;
    }
    final documentLocalization = view['documentLocalization'];
    if (documentLocalization != null &&
        (!_localization(documentLocalization) ||
            _map(documentLocalization)['requestedLocale'] != requestedLocale)) {
      return false;
    }
    if (hasSource) {
      final source = _map(view['sourceDocument']);
      if (requestedLocale == 'ru' ||
          documentLocalization == null ||
          _map(documentLocalization)['contentLocale'] != requestedLocale ||
          _map(documentLocalization)['fallbackReason'] != null ||
          _immutableDocument(source) != _immutableDocument(document) ||
          jsJsonStringify(source) == jsJsonStringify(document)) {
        return false;
      }
    }
    final chapters = view['chapters'];
    final stops = document['stops']! as List<Object?>;
    if (chapters is! List<Object?> || chapters.length != stops.length) return false;
    for (var index = 0; index < chapters.length; index += 1) {
      final item = chapters[index];
      if (!jsFields(item, const ['id', 'status', 'story', 'audio', 'localization'])) {
        return false;
      }
      final chapter = _map(item);
      if (chapter['id'] != _map(stops[index])['id'] ||
          !_statuses.contains(chapter['status']) ||
          !_nullOr(chapter, 'story', _storyValue) ||
          !_nullOr(chapter, 'audio', _audioValue) ||
          (chapter['audio'] != null && chapter['story'] == null)) {
        return false;
      }
      final localization = chapter['localization'];
      if (requestedLocale != 'ru' &&
          (localization == null ||
              !_localization(localization) ||
              _map(localization)['requestedLocale'] != requestedLocale)) {
        return false;
      }
      if (localization != null &&
          (!_localization(localization) ||
              _map(localization)['requestedLocale'] != requestedLocale)) {
        return false;
      }
      final contentLocale =
          localization == null ? 'ru' : _map(localization)['contentLocale'];
      final audio = chapter['audio'];
      if (audio != null && (_map(audio)['language'] ?? 'ru') != contentLocale) {
        return false;
      }
    }
    final driving = document['travelMode'] == 'driving';
    final limit = driving
        ? maxCarDocumentBytes * (hasSource ? 3 : 2)
        : hasSource
        ? 300000
        : 200000;
    return jsJsonStringify(value).length <= limit;
  }

  if (!_guard(valid)) failFormat();
}

/// Runs a validation; a structural surprise (TypeError) is a rejection too.
bool _guard(bool Function() check) {
  try {
    return check();
  } on FormatException {
    return false;
  } on TypeError {
    return false;
  }
}

// ---- Typed model -----------------------------------------------------------

enum ContentLocale {
  ru('ru'),
  en('en'),
  zh('zh');

  const ContentLocale(this.wire);
  final String wire;

  static ContentLocale parse(Object? value) =>
      readEnum(values, value, (item) => item.wire);
}

enum FallbackReason {
  missing('missing'),
  draft('draft'),
  stale('stale');

  const FallbackReason(this.wire);
  final String wire;
}

enum WalkMode {
  open('open'),
  loop('loop');

  const WalkMode(this.wire);
  final String wire;
}

enum TravelMode {
  walking('walking'),
  driving('driving');

  const TravelMode(this.wire);
  final String wire;
}

enum StoryRefKind {
  job('job'),
  osm('osm'),
  catalog('catalog');

  const StoryRefKind(this.wire);
  final String wire;
}

enum ChapterStatus {
  notRequested('not_requested'),
  preparing('preparing'),
  textReady('text_ready'),
  ready('ready'),
  failed('failed'),
  reviewRequired('review_required'),
  insufficientEvidence('insufficient_evidence'),
  unavailable('unavailable');

  const ChapterStatus(this.wire);
  final String wire;
}

GeoPoint? _optionalPoint(Object? value) => value == null ? null : readPoint(value);

class WalkPlace {
  const WalkPlace({required this.address, required this.location});

  factory WalkPlace._fromJson(Object? json) {
    final map = readMap(json);
    return WalkPlace(
      address: readString(map['address']),
      location: readPoint(map['location']),
    );
  }

  final String address;
  final GeoPoint location;

  Map<String, Object?> toJson() => {'address': address, 'location': location.toJson()};
}

class StoryRef {
  const StoryRef({required this.kind, required this.id});

  final StoryRefKind kind;
  final String id;

  Map<String, Object?> toJson() => {'kind': kind.wire, 'id': id};
}

class WalkStop {
  const WalkStop({
    required this.id,
    required this.place,
    required this.storyRef,
    required this.transition,
    required this.nextHint,
    this.placeId,
    this.triggerLocation,
  });

  factory WalkStop._fromJson(Object? json) {
    final map = readMap(json);
    final ref = map['storyRef'];
    return WalkStop(
      id: readString(map['id']),
      place: WalkPlace._fromJson(map['place']),
      storyRef: ref == null
          ? null
          : StoryRef(
              kind: readEnum(
                StoryRefKind.values,
                readMap(ref)['kind'],
                (item) => item.wire,
              ),
              id: readString(readMap(ref)['id']),
            ),
      placeId: map['placeId'] == null ? null : readString(map['placeId']),
      transition: readString(map['transition']),
      nextHint: readString(map['nextHint']),
      triggerLocation: _optionalPoint(map['triggerLocation']),
    );
  }

  final String id;
  final WalkPlace place;
  final StoryRef? storyRef;

  /// The map catalog place at the stop, independent of its story.
  final String? placeId;
  final String transition;
  final String nextHint;
  final GeoPoint? triggerLocation;

  Map<String, Object?> toJson() => {
    'id': id,
    'place': place.toJson(),
    'storyRef': storyRef?.toJson(),
    'placeId': ?placeId,
    'transition': transition,
    'nextHint': nextHint,
    if (triggerLocation != null) 'triggerLocation': triggerLocation!.toJson(),
  };
}

/// A covered stretch: segments between vertices [start]..[end] run through a tunnel.
class TunnelRange {
  const TunnelRange(this.start, this.end);

  final int start;
  final int end;

  List<int> toJson() => [start, end];

  @override
  bool operator ==(Object other) =>
      other is TunnelRange && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);
}

class WalkDocumentRoute {
  WalkDocumentRoute({
    required List<GeoPoint> geometry,
    required this.distanceM,
    required this.walkingMinutes,
    required this.attribution,
    List<TunnelRange>? tunnels,
    this.car,
  }) : geometry = List.unmodifiable(geometry),
       tunnels = tunnels == null ? null : List.unmodifiable(tunnels);

  factory WalkDocumentRoute._fromJson(Object? json) {
    final map = readMap(json);
    final tunnels = map['tunnels'];
    return WalkDocumentRoute(
      geometry: readList(map['geometry']).map(readPoint).toList(),
      distanceM: readDouble(map['distanceM']),
      walkingMinutes: readDouble(map['walkingMinutes']),
      attribution: readString(map['attribution']),
      tunnels: tunnels == null
          ? null
          : [
              for (final pair in readList(tunnels))
                TunnelRange(readInt(readList(pair)[0]), readInt(readList(pair)[1])),
            ],
      car: map['car'] == null ? null : CarRoute.fromJson(map['car']),
    );
  }

  final List<GeoPoint> geometry;
  final double distanceM;
  final double walkingMinutes;
  final String attribution;

  /// Absent for routes built before tunnel data.
  final List<TunnelRange>? tunnels;
  final CarRoute? car;

  Map<String, Object?> toJson() => {
    'geometry': [for (final point in geometry) point.toJson()],
    'distanceM': distanceM,
    'walkingMinutes': walkingMinutes,
    'attribution': attribution,
    if (tunnels != null) 'tunnels': [for (final tunnel in tunnels!) tunnel.toJson()],
    if (car != null) 'car': car!.toJson(),
  };
}

class WalkDocument {
  WalkDocument._({
    required this.id,
    required this.title,
    required this.description,
    required this.city,
    required this.mode,
    required this.minutes,
    required this.travelMode,
    required this.start,
    required this.destination,
    required List<WalkStop> stops,
    required this.route,
    required this.fieldChecked,
  }) : stops = List.unmodifiable(stops);

  /// Validates like validateWalkDocument; throws [FormatException] when the site would reject it.
  factory WalkDocument.fromJson(Object? json) {
    validateWalkDocumentJson(json);
    return WalkDocument._parse(json);
  }

  factory WalkDocument._parse(Object? json) {
    final map = readMap(json);
    return WalkDocument._(
      id: readString(map['id']),
      title: readString(map['title']),
      description: readString(map['description']),
      city: readString(map['city']),
      mode: readEnum(WalkMode.values, map['mode'], (item) => item.wire),
      minutes: readInt(map['minutes']),
      travelMode: map['travelMode'] == null
          ? null
          : readEnum<TravelMode>(TravelMode.values, map['travelMode'], (item) => item.wire),
      start: map['start'] == null ? null : WalkPlace._fromJson(map['start']),
      destination: map['destination'] == null
          ? null
          : WalkPlace._fromJson(map['destination']),
      stops: readList(map['stops']).map(WalkStop._fromJson).toList(),
      route: map['route'] == null ? null : WalkDocumentRoute._fromJson(map['route']),
      fieldChecked: readBool(map['fieldChecked']),
    );
  }

  int get version => 2;
  final String id;
  final String title;
  final String description;
  final String city;
  final WalkMode mode;
  final int minutes;

  /// Absent on walking documents saved before car walks existed.
  final TravelMode? travelMode;
  final WalkPlace? start;
  final WalkPlace? destination;
  final List<WalkStop> stops;
  final WalkDocumentRoute? route;
  final bool fieldChecked;

  bool get driving => travelMode == TravelMode.driving;

  Map<String, Object?> toJson() => {
    'version': version,
    if (travelMode != null) 'travelMode': travelMode!.wire,
    'id': id,
    'title': title,
    'description': description,
    'city': city,
    'mode': mode.wire,
    'minutes': minutes,
    'start': start?.toJson(),
    if (destination != null) 'destination': destination!.toJson(),
    'stops': [for (final stop in stops) stop.toJson()],
    'route': route?.toJson(),
    'fieldChecked': fieldChecked,
  };
}

class WalkStoryParagraph {
  WalkStoryParagraph({required this.text, required List<String> factIds})
    : factIds = List.unmodifiable(factIds);

  final String text;
  final List<String> factIds;

  Map<String, Object?> toJson() => {'text': text, 'factIds': factIds};
}

class WalkStorySource {
  const WalkStorySource({
    required this.id,
    required this.title,
    required this.url,
    required this.publisher,
  });

  final String id;
  final String title;
  final String url;
  final String publisher;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'url': url,
    'publisher': publisher,
  };
}

class WalkStoryFact {
  WalkStoryFact({required this.id, required this.claim, required List<String> sourceIds})
    : sourceIds = List.unmodifiable(sourceIds);

  final String id;
  final String claim;
  final List<String> sourceIds;

  Map<String, Object?> toJson() => {'id': id, 'claim': claim, 'sourceIds': sourceIds};
}

List<String> _strings(Object? value) => readList(value).map(readString).toList();

class WalkStory {
  WalkStory({
    required this.title,
    required this.address,
    required List<WalkStoryParagraph> paragraphs,
    required List<WalkStorySource> sources,
    required List<WalkStoryFact> facts,
    this.checkedAt,
  }) : paragraphs = List.unmodifiable(paragraphs),
       sources = List.unmodifiable(sources),
       facts = List.unmodifiable(facts);

  factory WalkStory._fromJson(Object? json) {
    final map = readMap(json);
    return WalkStory(
      title: readString(map['title']),
      address: readString(map['address']),
      paragraphs: [
        for (final item in readList(map['paragraphs']))
          WalkStoryParagraph(
            text: readString(readMap(item)['text']),
            factIds: _strings(readMap(item)['factIds']),
          ),
      ],
      sources: [
        for (final item in readList(map['sources']))
          WalkStorySource(
            id: readString(readMap(item)['id']),
            title: readString(readMap(item)['title']),
            url: readString(readMap(item)['url']),
            publisher: readString(readMap(item)['publisher']),
          ),
      ],
      facts: [
        for (final item in readList(map['facts']))
          WalkStoryFact(
            id: readString(readMap(item)['id']),
            claim: readString(readMap(item)['claim']),
            sourceIds: _strings(readMap(item)['sourceIds']),
          ),
      ],
      checkedAt: map['checkedAt'] == null ? null : readString(map['checkedAt']),
    );
  }

  final String title;
  final String address;
  final List<WalkStoryParagraph> paragraphs;
  final List<WalkStorySource> sources;
  final List<WalkStoryFact> facts;

  /// `YYYY-MM-DD`.
  final String? checkedAt;

  Map<String, Object?> toJson() => {
    'title': title,
    'address': address,
    'paragraphs': [for (final item in paragraphs) item.toJson()],
    'sources': [for (final item in sources) item.toJson()],
    'facts': [for (final item in facts) item.toJson()],
    'checkedAt': ?checkedAt,
  };
}

class WalkAudio {
  const WalkAudio({
    required this.url,
    required this.sha256,
    required this.durationSec,
    this.language,
  });

  factory WalkAudio._fromJson(Object? json) {
    final map = readMap(json);
    return WalkAudio(
      url: readString(map['url']),
      sha256: readString(map['sha256']),
      durationSec: readDouble(map['durationSec']),
      language: map['language'] == null ? null : ContentLocale.parse(map['language']),
    );
  }

  /// Site-relative: `/api/story-audio/<sha256>.mp3` or `/audio/walk/<name>.mp3`.
  final String url;
  final String sha256;
  final double durationSec;
  final ContentLocale? language;

  Map<String, Object?> toJson() => {
    'url': url,
    'sha256': sha256,
    'durationSec': durationSec,
    if (language != null) 'language': language!.wire,
  };
}

class WalkLocalization {
  const WalkLocalization({
    required this.requestedLocale,
    required this.contentLocale,
    required this.fallbackReason,
  });

  factory WalkLocalization._fromJson(Object? json) {
    final map = readMap(json);
    return WalkLocalization(
      requestedLocale: ContentLocale.parse(map['requestedLocale']),
      contentLocale: ContentLocale.parse(map['contentLocale']),
      fallbackReason: map['fallbackReason'] == null
          ? null
          : readEnum<FallbackReason>(FallbackReason.values, map['fallbackReason'], (item) => item.wire),
    );
  }

  final ContentLocale requestedLocale;
  final ContentLocale contentLocale;
  final FallbackReason? fallbackReason;

  Map<String, Object?> toJson() => {
    'requestedLocale': requestedLocale.wire,
    'contentLocale': contentLocale.wire,
    'fallbackReason': fallbackReason?.wire,
  };
}

/// One stop's story state in a walk view (`WalkView["chapters"][number]`).
class WalkChapter {
  const WalkChapter({
    required this.id,
    required this.status,
    required this.story,
    required this.audio,
    this.localization,
  });

  factory WalkChapter._fromJson(Object? json) {
    final map = readMap(json);
    return WalkChapter(
      id: readString(map['id']),
      status: readEnum(ChapterStatus.values, map['status'], (item) => item.wire),
      story: map['story'] == null ? null : WalkStory._fromJson(map['story']),
      audio: map['audio'] == null ? null : WalkAudio._fromJson(map['audio']),
      localization: map['localization'] == null
          ? null
          : WalkLocalization._fromJson(map['localization']),
    );
  }

  final String id;
  final ChapterStatus status;
  final WalkStory? story;
  final WalkAudio? audio;
  final WalkLocalization? localization;

  /// `chapterContentLocale`.
  ContentLocale get contentLocale => localization?.contentLocale ?? ContentLocale.ru;

  Map<String, Object?> toJson() => {
    'id': id,
    'status': status.wire,
    'story': story?.toJson(),
    'audio': audio?.toJson(),
    if (localization != null) 'localization': localization!.toJson(),
  };
}

class WalkView {
  WalkView._({
    required this.document,
    required this.sourceDocument,
    required this.documentLocalization,
    required this.revision,
    required this.contentVersion,
    required this.requestedLocale,
    required List<WalkChapter> chapters,
  }) : chapters = List.unmodifiable(chapters);

  /// Validates like validateWalkView; throws [FormatException] when the site would reject it.
  factory WalkView.fromJson(Object? json) {
    validateWalkViewJson(json);
    final map = readMap(json);
    return WalkView._(
      document: WalkDocument._parse(map['document']),
      sourceDocument: map['sourceDocument'] == null
          ? null
          : WalkDocument._parse(map['sourceDocument']),
      documentLocalization: map['documentLocalization'] == null
          ? null
          : WalkLocalization._fromJson(map['documentLocalization']),
      revision: readInt(map['revision']),
      contentVersion: readString(map['contentVersion']),
      requestedLocale: map['requestedLocale'] == null
          ? null
          : ContentLocale.parse(map['requestedLocale']),
      chapters: readList(map['chapters']).map(WalkChapter._fromJson).toList(),
    );
  }

  final WalkDocument document;
  final WalkDocument? sourceDocument;
  final WalkLocalization? documentLocalization;
  final int revision;
  final String contentVersion;
  final ContentLocale? requestedLocale;
  final List<WalkChapter> chapters;

  /// `walkRequestedLocale`.
  ContentLocale get locale => requestedLocale ?? ContentLocale.ru;

  Map<String, Object?> toJson() => {
    'document': document.toJson(),
    if (sourceDocument != null) 'sourceDocument': sourceDocument!.toJson(),
    if (documentLocalization != null)
      'documentLocalization': documentLocalization!.toJson(),
    'revision': revision,
    'contentVersion': contentVersion,
    if (requestedLocale != null) 'requestedLocale': requestedLocale!.wire,
    'chapters': [for (final chapter in chapters) chapter.toJson()],
  };
}
