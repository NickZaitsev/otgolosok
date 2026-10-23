// Port of backend/car-route.mjs: the car route wire contract. Stories remain
// stops; a parking visit owns one or more stories.
import 'dart:math' as math;

import 'distance.dart';
import 'js_json.dart' show jsJsonStringify;
import 'json_read.dart';

const List<int> carMinutes = [60, 120, 180];
const int maxCarDistanceM = 250000;
const int maxCarVertices = 30000;
const int maxCarDocumentBytes = 1500000;

enum ParkingAccess {
  public('public'),
  unknown('unknown');

  const ParkingAccess(this.wire);
  final String wire;
}

enum TravelSegmentMode {
  driving('driving'),
  walking('walking');

  const TravelSegmentMode(this.wire);
  final String wire;
}

class ParkingPlace {
  const ParkingPlace({
    required this.id,
    required this.name,
    required this.location,
    required this.entrance,
    required this.exit,
    required this.pedestrianAccess,
    required this.access,
    required this.fee,
    required this.openingHours,
  });

  /// Structural parse; semantic checks are [validCarRoute].
  factory ParkingPlace.fromJson(Object? json) {
    final map = readMap(json);
    return ParkingPlace(
      id: readString(map['id']),
      name: readString(map['name']),
      location: readPoint(map['location']),
      entrance: readPoint(map['entrance']),
      exit: readPoint(map['exit']),
      pedestrianAccess: readPoint(map['pedestrianAccess']),
      access: readEnum(ParkingAccess.values, map['access'], (item) => item.wire),
      fee: map['fee'] == null ? null : readBool(map['fee']),
      openingHours: map['openingHours'] == null
          ? null
          : readString(map['openingHours']),
    );
  }

  final String id;
  final String name;
  final GeoPoint location;
  final GeoPoint entrance;
  final GeoPoint exit;
  final GeoPoint pedestrianAccess;
  final ParkingAccess access;
  final bool? fee;
  final String? openingHours;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'location': location.toJson(),
    'entrance': entrance.toJson(),
    'exit': exit.toJson(),
    'pedestrianAccess': pedestrianAccess.toJson(),
    'access': access.wire,
    'fee': fee,
    'openingHours': openingHours,
  };
}

class ParkingVisit {
  ParkingVisit({
    required this.id,
    required this.parking,
    required List<String> stopIds,
    required this.visitMinutes,
    required this.parkingMinutes,
  }) : stopIds = List.unmodifiable(stopIds);

  factory ParkingVisit.fromJson(Object? json) {
    final map = readMap(json);
    return ParkingVisit(
      id: readString(map['id']),
      parking: ParkingPlace.fromJson(map['parking']),
      stopIds: readList(map['stopIds']).map(readString).toList(),
      visitMinutes: readDouble(map['visitMinutes']),
      parkingMinutes: readDouble(map['parkingMinutes']),
    );
  }

  final String id;
  final ParkingPlace parking;
  final List<String> stopIds;
  final double visitMinutes;
  final double parkingMinutes;

  Map<String, Object?> toJson() => {
    'id': id,
    'parking': parking.toJson(),
    'stopIds': stopIds,
    'visitMinutes': visitMinutes,
    'parkingMinutes': parkingMinutes,
  };
}

class TravelSegment {
  TravelSegment({
    required this.mode,
    required this.visitId,
    required List<GeoPoint> geometry,
    required this.distanceM,
    required this.minutes,
  }) : geometry = List.unmodifiable(geometry);

  factory TravelSegment.fromJson(Object? json) {
    final map = readMap(json);
    return TravelSegment(
      mode: readEnum(TravelSegmentMode.values, map['mode'], (item) => item.wire),
      visitId: map['visitId'] == null ? null : readString(map['visitId']),
      geometry: readList(map['geometry']).map(readPoint).toList(),
      distanceM: readDouble(map['distanceM']),
      minutes: readDouble(map['minutes']),
    );
  }

  final TravelSegmentMode mode;
  final String? visitId;
  final List<GeoPoint> geometry;
  final double distanceM;
  final double minutes;

  Map<String, Object?> toJson() => {
    'mode': mode.wire,
    'visitId': visitId,
    'geometry': [for (final point in geometry) point.toJson()],
    'distanceM': distanceM,
    'minutes': minutes,
  };
}

class CarRoute {
  CarRoute({
    required this.drivingMinutes,
    required this.totalMinutes,
    required List<ParkingVisit> visits,
    required List<TravelSegment> segments,
  }) : visits = List.unmodifiable(visits),
       segments = List.unmodifiable(segments);

  /// Structural parse (types only). Walk documents run [validCarRoute] first.
  factory CarRoute.fromJson(Object? json) {
    final map = readMap(json);
    return CarRoute(
      drivingMinutes: readDouble(map['drivingMinutes']),
      totalMinutes: readInt(map['totalMinutes']),
      visits: readList(map['visits']).map(ParkingVisit.fromJson).toList(),
      segments: readList(map['segments']).map(TravelSegment.fromJson).toList(),
    );
  }

  final double drivingMinutes;
  final int totalMinutes;
  final List<ParkingVisit> visits;
  final List<TravelSegment> segments;

  Map<String, Object?> toJson() => {
    'drivingMinutes': drivingMinutes,
    'totalMinutes': totalMinutes,
    'visits': [for (final visit in visits) visit.toJson()],
    'segments': [for (final segment in segments) segment.toJson()],
  };
}

/// `copyCarRoute`: the same route with stop ids renamed through [stopIds].
/// Dart values are immutable, so only the renaming is meaningful here.
CarRoute copyCarRoute(CarRoute car, [Map<String, String> stopIds = const {}]) =>
    CarRoute(
      drivingMinutes: car.drivingMinutes,
      totalMinutes: car.totalMinutes,
      visits: [
        for (final visit in car.visits)
          ParkingVisit(
            id: visit.id,
            parking: visit.parking,
            stopIds: [for (final id in visit.stopIds) stopIds[id] ?? id],
            visitMinutes: visit.visitMinutes,
            parkingMinutes: visit.parkingMinutes,
          ),
      ],
      segments: car.segments,
    );

/// Map overview geometry, with no artificial connector between distinct access points.
List<GeoPoint> carRouteGeometry(CarRoute car) {
  final result = <GeoPoint>[];
  for (final segment in car.segments) {
    final first = segment.geometry.first;
    final last = result.isEmpty ? null : result.last;
    final joined = last != null && first.lat == last.lat && first.lon == last.lon;
    result.addAll(joined ? segment.geometry.skip(1) : segment.geometry);
  }
  return result;
}

// ---- Raw validation (backend/car-route.mjs) --------------------------------

typedef PointCheck = bool Function(Map<String, Object?> point);

final RegExp _forbiddenText = RegExp(r'[\p{Cc}\p{Cf}<>]', unicode: true);
final RegExp _identifier = RegExp(r'^[a-z0-9][a-z0-9-]{0,127}$');
final RegExp _parkingId = RegExp(r'^osm:(node|way|relation):[1-9]\d*$');

bool _text(Object? value, int max) =>
    value is String &&
    value.trim().isNotEmpty &&
    value.length <= max &&
    !_forbiddenText.hasMatch(value);

bool _isIdentifier(Object? value) =>
    value is String && _identifier.hasMatch(value);

bool _point(Object? value) {
  if (!jsFields(value, const ['lat', 'lon'])) return false;
  final map = value! as Map<String, Object?>;
  final lat = map['lat'];
  final lon = map['lon'];
  return lat is num &&
      lat.isFinite &&
      lat.abs() <= 90 &&
      lon is num &&
      lon.isFinite &&
      lon.abs() <= 180;
}

bool _number(Object? value, num max) =>
    value is num && value.isFinite && value >= 0 && value <= max;

double _distance(Map<String, Object?> a, Map<String, Object?> b) {
  final aLat = (a['lat']! as num).toDouble();
  final aLon = (a['lon']! as num).toDouble();
  final bLat = (b['lat']! as num).toDouble();
  final bLon = (b['lon']! as num).toDouble();
  final dx = (aLat - bLat) * 111320;
  final dy = (aLon - bLon) * 111320 * math.cos((aLat + bLat) * math.pi / 360);
  return math.sqrt(dx * dx + dy * dy);
}

bool _anyPoint(Map<String, Object?> point) => true;

/// `validParkingPlace` on a decoded JSON value.
bool validParkingPlace(Object? value, [PointCheck validPoint = _anyPoint]) {
  if (!jsFields(value, const [
    'id',
    'name',
    'location',
    'entrance',
    'exit',
    'pedestrianAccess',
    'access',
    'fee',
    'openingHours',
  ])) {
    return false;
  }
  final map = value! as Map<String, Object?>;
  final id = map['id'];
  if (id is! String || !_parkingId.hasMatch(id) || !_text(map['name'], 180)) {
    return false;
  }
  for (final key in const ['location', 'entrance', 'exit', 'pedestrianAccess']) {
    final point = map[key];
    if (!_point(point) || !validPoint(point! as Map<String, Object?>)) {
      return false;
    }
  }
  if (map['access'] != 'public' && map['access'] != 'unknown') return false;
  // `fee === null`: an absent key is undefined, not null, and fails.
  if (!map.containsKey('fee') || (map['fee'] != null && map['fee'] is! bool)) {
    return false;
  }
  if (!map.containsKey('openingHours') ||
      (map['openingHours'] != null && !_text(map['openingHours'], 500))) {
    return false;
  }
  final location = map['location']! as Map<String, Object?>;
  return _distance(location, map['entrance']! as Map<String, Object?>) <= 1000 &&
      _distance(location, map['exit']! as Map<String, Object?>) <= 1000 &&
      _distance(location, map['pedestrianAccess']! as Map<String, Object?>) <=
          1000;
}

/// `validCarRoute` on a decoded JSON value: geometry is frozen with the visit references.
bool validCarRoute(
  Object? value,
  List<Object?> stopIds, [
  PointCheck validPoint = _anyPoint,
]) {
  if (!jsFields(value, const [
    'drivingMinutes',
    'totalMinutes',
    'visits',
    'segments',
  ])) {
    return false;
  }
  final map = value! as Map<String, Object?>;
  final totalMinutes = map['totalMinutes'];
  final visits = map['visits'];
  final segments = map['segments'];
  if (!_number(map['drivingMinutes'], 180) ||
      !_number(totalMinutes, 180) ||
      (totalMinutes! as num) <= 0 ||
      !jsIsInteger(totalMinutes) ||
      visits is! List<Object?> ||
      visits.isEmpty ||
      visits.length > 40 ||
      segments is! List<Object?> ||
      (segments.length != visits.length * 2 &&
          segments.length != visits.length * 2 + 1) ||
      stopIds.isEmpty ||
      stopIds.toSet().length != stopIds.length) {
    return false;
  }
  final ids = <String>{};
  final covered = <Object?>[];
  for (final visit in visits) {
    if (!jsFields(visit, const [
      'id',
      'parking',
      'stopIds',
      'visitMinutes',
      'parkingMinutes',
    ])) {
      return false;
    }
    final item = visit! as Map<String, Object?>;
    final id = item['id'];
    final visitStops = item['stopIds'];
    if (!_isIdentifier(id) ||
        ids.contains(id) ||
        !validParkingPlace(item['parking'], validPoint) ||
        visitStops is! List<Object?> ||
        visitStops.isEmpty ||
        visitStops.length > 40 ||
        !visitStops.every(_isIdentifier) ||
        !_number(item['visitMinutes'], 120) ||
        (item['visitMinutes']! as num) <= 0 ||
        !_number(item['parkingMinutes'], 30)) {
      return false;
    }
    ids.add(id! as String);
    covered.addAll(visitStops);
  }
  if (covered.length != stopIds.length) return false;
  for (var index = 0; index < covered.length; index += 1) {
    if (covered[index] != stopIds[index]) return false;
  }
  var vertices = 0;
  num drive = 0;
  num walk = 0;
  for (var index = 0; index < segments.length; index += 1) {
    final segmentValue = segments[index];
    final visitIndex = index ~/ 2;
    final visit = visitIndex < visits.length
        ? visits[visitIndex]! as Map<String, Object?>
        : null;
    if (!jsFields(segmentValue, const [
      'mode',
      'visitId',
      'geometry',
      'distanceM',
      'minutes',
    ])) {
      return false;
    }
    final segment = segmentValue! as Map<String, Object?>;
    final mode = segment['mode'];
    final geometry = segment['geometry'];
    if ((mode != 'driving' && mode != 'walking') ||
        geometry is! List<Object?> ||
        geometry.length < 2 ||
        !geometry.every(
          (point) =>
              _point(point) && validPoint(point! as Map<String, Object?>),
        ) ||
        !_number(segment['distanceM'], maxCarDistanceM) ||
        !_number(segment['minutes'], 180)) {
      return false;
    }
    vertices += geometry.length;
    if (vertices > maxCarVertices) return false;
    final first = geometry.first! as Map<String, Object?>;
    final last = geometry.last! as Map<String, Object?>;
    if (visit != null) {
      final parking = visit['parking']! as Map<String, Object?>;
      if (segment['visitId'] != visit['id'] ||
          mode != (index.isEven ? 'driving' : 'walking')) {
        return false;
      }
      if (index.isEven) {
        if (_distance(last, parking['entrance']! as Map<String, Object?>) > 75) {
          return false;
        }
        if (index > 0) {
          final previous =
              visits[visitIndex - 1]! as Map<String, Object?>;
          final previousParking =
              previous['parking']! as Map<String, Object?>;
          if (_distance(first, previousParking['exit']! as Map<String, Object?>) >
              75) {
            return false;
          }
        }
      } else {
        final distanceM = segment['distanceM']! as num;
        final access = parking['pedestrianAccess']! as Map<String, Object?>;
        if (distanceM <= 0 ||
            (segment['minutes']! as num) <= 0 ||
            distanceM > 1500 ||
            _distance(first, access) > 75 ||
            _distance(last, access) > 75) {
          return false;
        }
      }
    } else {
      final lastVisit = visits.last! as Map<String, Object?>;
      final lastParking = lastVisit['parking']! as Map<String, Object?>;
      // `segment.visitId !== null`: an absent key is undefined and fails.
      if (!segment.containsKey('visitId') ||
          segment['visitId'] != null ||
          mode != 'driving' ||
          _distance(first, lastParking['exit']! as Map<String, Object?>) > 75) {
        return false;
      }
    }
    if (mode == 'driving') {
      drive += segment['minutes']! as num;
    } else {
      walk += segment['minutes']! as num;
    }
  }
  num visiting = 0;
  for (final visit in visits) {
    final item = visit! as Map<String, Object?>;
    visiting += (item['visitMinutes']! as num) + (item['parkingMinutes']! as num);
  }
  return ((map['drivingMinutes']! as num) - drive).abs() <= 1 &&
      totalMinutes == (drive + walk + visiting).ceil();
}

/// JSON text of `carRouteGeometry` over a validated raw car route.
String rawCarRouteGeometryJson(Map<String, Object?> car) {
  final result = <Object?>[];
  for (final segmentValue in car['segments']! as List<Object?>) {
    final geometry =
        (segmentValue! as Map<String, Object?>)['geometry']! as List<Object?>;
    final first = geometry.first! as Map<String, Object?>;
    final last = result.isEmpty ? null : result.last as Map<String, Object?>?;
    final joined =
        last != null && first['lat'] == last['lat'] && first['lon'] == last['lon'];
    result.addAll(joined ? geometry.skip(1) : geometry);
  }
  return jsJsonStringify(result);
}
