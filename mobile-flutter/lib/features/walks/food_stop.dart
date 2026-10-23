// Port of src/features/walks/food-stop.ts: where a food place joins a walking walk as a new stop, the
// /api/walk-plan request for the way through it, and the document with that way spliced into the route.
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../core/i18n/user_message.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/route_legs.dart';
import '../../walk_engine/walk_view.dart';
import '../food/food_kinds.dart';
import '../food/food_model.dart';
import '../food/route_proximity.dart';
import '../walk_builder/model.dart' show Plan;
import 'walk_loader.dart';

/// A food stop that cannot join the walk; the message is Russian source text for the walker.
class FoodStopError implements UserFacingError {
  const FoodStopError(this.message);
  @override
  final String message;

  @override
  String toString() => 'FoodStopError: $message';
}

/// Where a venue joins the walk: before stop [position] of the document, replacing the path between
/// geometry vertices [range] with a way from [from] through the venue to [to].
@immutable
class FoodStopLeg {
  const FoodStopLeg({required this.position, required this.range, required this.from, required this.to});

  final int position;
  final (int, int) range;
  final GeoPoint from;
  final GeoPoint to;

  @override
  bool operator ==(Object other) =>
      other is FoodStopLeg && other.position == position && other.range == range && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(position, range, from, to);

  @override
  String toString() => 'FoodStopLeg($position, $range, $from → $to)';
}

// The planner keeps every pair of points at least 5 m apart; a venue this close to the line needs no new way.
const double _onRouteM = 5;
// The backend rejects a leg whose ends leave a gap; the joints of a spliced leg obey the same rule.
const double _maxJointGapM = 10;
const String _routePoint = 'Точка маршрута';
const _noRoute = FoodStopError('У прогулки ещё нет маршрута.');
const _notJoined = FoodStopError('Не удалось соединить путь к заведению с маршрутом.');
const _tooLong = FoodStopError('С этим заведением прогулка станет длиннее 90 минут.');
const _walkingOnly = FoodStopError('Добавление заведения пока доступно только для пешеходных прогулок.');

final RegExp _forbidden = RegExp(r'[\p{Cc}\p{Cf}<>]', unicode: true);
final RegExp _spaces = RegExp(r'\s+');

double _distanceM(GeoPoint a, GeoPoint b) {
  final scaleX = 111320 * math.cos(((a.lat + b.lat) / 2) * math.pi / 180);
  final dx = (b.lon - a.lon) * scaleX, dy = (b.lat - a.lat) * 111320;
  return math.sqrt(dx * dx + dy * dy);
}

double _pathLength(List<GeoPoint> points) {
  var sum = 0.0;
  for (var i = 1; i < points.length; i++) {
    sum += _distanceM(points[i - 1], points[i]);
  }
  return sum;
}

/// Whether the document already has a stop at the venue, matched by its exact coordinates.
bool hasFoodStop(WalkDocument document, GeoPoint place) => document.stops.any((stop) => stop.place.location == place);

/// The leg of the walk the venue lies by: the stops around it and the stretch of path between them.
FoodStopLeg foodStopLeg(WalkDocument document, GeoPoint place) {
  if (document.driving || document.route?.car != null) throw _walkingOnly;
  final geometry = document.route?.geometry;
  if (geometry == null || geometry.length < 2) throw _noRoute;
  if (hasFoodStop(document, place)) throw const FoodStopError('Заведение уже есть в прогулке.');
  if (document.stops.length >= maxWalkStops) throw const FoodStopError('В прогулке уже $maxWalkStops остановок — больше добавить нельзя.');
  final cuts = routeLegCuts(geometry, [for (final stop in document.stops) stop.triggerLocation ?? stop.place.location]);
  // The venue projects onto the segment that starts at `vertex`; the leg owning that segment takes it.
  final vertex = distanceToRoute(place, geometry, mode: document.mode).vertex;
  final position = cuts.where((cut) => cut <= vertex).length;
  final a = position == 0 ? 0 : cuts[position - 1];
  final b = position == cuts.length ? geometry.length - 1 : cuts[position];
  return FoodStopLeg(position: position, range: (a, b), from: geometry[a], to: geometry[b]);
}

/// The `/api/walk-plan` request for the way through the venue; null when the venue stands on the line itself.
Map<String, Object?>? foodLegRequest(FoodStopLeg leg, FoodPlace place) {
  final venue = place.location;
  if (_distanceM(leg.from, venue) < _onRouteM || _distanceM(leg.to, venue) < _onRouteM) return null;
  // Ends of a leg without length (a stop at the start, a finish at the last stop) make a small loop.
  final loop = _distanceM(leg.from, leg.to) < _onRouteM;
  // The leg alone is short; the largest budget keeps the planner's duration check out of the way.
  return {
    'start': {'address': _routePoint, 'location': leg.from.toJson()},
    'mode': loop ? 'loop' : 'open',
    'minutes': 90,
    'stops': [
      {'address': foodStopTitle(place.name, place.kind), 'location': venue.toJson()},
    ],
    if (!loop) 'destination': {'address': _routePoint, 'location': leg.to.toJson()},
  };
}

/// The stop title: the venue's name, cleaned to what a walk document accepts; the kind label when nothing is left.
String foodStopTitle(String name, FoodKind kind) {
  final cleaned = name.replaceAll(_forbidden, ' ').replaceAll(_spaces, ' ').trim().runes.toList();
  final title = cleaned.length > 180 ? '${String.fromCharCodes(cleaned.sublist(0, 179))}…' : String.fromCharCodes(cleaned);
  return title.isNotEmpty ? title : foodKindLabel(kind);
}

/// The old tunnels outside the replaced stretch [range] (cut at its edges, the ones after it shifted to
/// [suffixStart]) and the new way's tunnels at [legOffset], merged; null when none are left.
List<List<int>>? _spliceTunnels(List<(int, int)> old, List<(int, int)> leg, (int, int) range, int legOffset, int suffixStart) {
  final (a, b) = range;
  final pieces = <(int, int)>[];
  for (final (from, to) in old) {
    if (from < a && math.min(to, a) > from) pieces.add((from, math.min(to, a)));
    if (to > b) {
      final start = suffixStart + math.max<int>(from, b) - b, end = suffixStart + to - b;
      if (end > start) pieces.add((start, end));
    }
  }
  for (final (from, to) in leg) {
    pieces.add((legOffset + from, legOffset + to));
  }
  pieces.sort((x, y) => x.$1 - y.$1);
  final merged = <List<int>>[];
  for (final (from, to) in pieces) {
    if (merged.isNotEmpty && from <= merged.last[1]) {
      merged.last[1] = math.max(merged.last[1], to);
    } else {
      merged.add([from, to]);
    }
  }
  return merged.isEmpty ? null : merged;
}

/// The [document] JSON with the venue as a stop without a story, its way ([plan], null for a venue on the
/// line) spliced into the path in place of the old leg. The rest of the path, its tunnels and every other
/// stop stay as they were; the stop before the venue loses its hint about the way on, which led past the
/// venue to the next stop. Returns the validated document JSON; [document] is not changed.
Map<String, Object?> insertFoodStop(Map<String, Object?> document, FoodPlace place, FoodStopLeg leg, Plan? plan, String stopId) {
  final rawRoute = document['route'];
  if (document['travelMode'] == 'driving' || (rawRoute is Map<String, Object?> && rawRoute['car'] != null)) throw _walkingOnly;
  if (rawRoute == null) throw _noRoute;
  final route = readMap(rawRoute);
  var next = route;
  var walkingMinutes = readDouble(route['walkingMinutes']);
  if (plan != null) {
    final oldRaw = readList(route['geometry']), old = oldRaw.map(readPoint).toList(), way = plan.geometry;
    final (a, b) = leg.range;
    if (b >= old.length || a > b) throw _notJoined;
    final head = _distanceM(old[a], way.first), tail = _distanceM(way.last, old[b]);
    // Never draw an invented segment between the old path and the new way.
    if (head > _maxJointGapM || tail > _maxJointGapM) throw _notJoined;
    final body = [for (final point in head < 1 ? way.skip(1) : way) point.toJson()];
    final geometry = <Object?>[...oldRaw.sublist(0, a + 1), ...body, ...oldRaw.sublist(tail < 1 ? b + 1 : b)];
    final legOffset = head < 1 ? a : a + 1, legEnd = legOffset + way.length - 1;
    final oldTunnels = route['tunnels'] == null ? const <(int, int)>[] : [for (final pair in readList(route['tunnels'])) (readInt(readList(pair)[0]), readInt(readList(pair)[1]))];
    final tunnels = _spliceTunnels(oldTunnels, plan.tunnels ?? const [], leg.range, legOffset, tail < 1 ? legEnd : legEnd + 1);
    // The stored length is the router's; the removed share of it follows the share of the drawn line.
    final drawn = _pathLength(old), removed = drawn > 0 ? _pathLength(old.sublist(a, b + 1)) / drawn : 0.0;
    final distanceKept = readDouble(route['distanceM']) * (1 - removed), minutesKept = walkingMinutes * (1 - removed);
    final distanceM = jsRound(distanceKept + plan.distanceM);
    walkingMinutes = (minutesKept + plan.walkingMinutes).ceilToDouble();
    next = {
      'geometry': geometry,
      'distanceM': distanceM,
      'walkingMinutes': walkingMinutes.toInt(),
      'attribution': route['attribution'],
      'tunnels': ?tunnels,
    };
    if (geometry.length > 12000 || distanceM > 8100 || walkingMinutes > 90) throw _tooLong;
    if (!validTunnels(next, geometry.length) || (tunnels?.length ?? 0) > maxRouteTunnels) throw _notJoined;
  }
  final stops = readList(document['stops']);
  final changedStops = <Object?>[
    for (var i = 0; i < stops.length; i++) i == leg.position - 1 ? {...readMap(stops[i]), 'transition': '', 'nextHint': ''} : stops[i],
  ]..insert(leg.position, {
      'id': stopId,
      'place': {'address': foodStopTitle(place.name, place.kind), 'location': place.location.toJson()},
      'storyRef': null,
      'transition': '',
      'nextHint': '',
    });
  // A longer walk moves to the next duration the builder offers, so rebuilding it there still fits.
  final current = readInt(document['minutes']);
  final minutes = walkingMinutes > current ? const [30, 60, 90].firstWhere((value) => value >= walkingMinutes, orElse: () => 90) : current;
  final changed = <String, Object?>{...document, 'minutes': minutes, 'stops': changedStops, 'route': next};
  validateWalkDocumentJson(changed);
  return changed;
}

/// The view of the changed [document]: every stop keeps its story and recording, a new one has none yet.
/// The new document is the Russian source, so a translated view keeps its language with a stale document.
WalkViewData viewWithDocument(WalkViewData data, Map<String, Object?> document, int revision, String contentVersion) {
  final chapters = {
    for (final chapter in readList(data.json['chapters'])) readMap(chapter)['id']: chapter,
  };
  final requested = data.view.requestedLocale?.wire;
  final json = <String, Object?>{
    'document': document,
    'revision': revision,
    'contentVersion': contentVersion,
    if (requested != null) ...{
      'requestedLocale': requested,
      'documentLocalization': {'requestedLocale': requested, 'contentLocale': 'ru', 'fallbackReason': 'stale'},
    },
    'chapters': [
      for (final stop in readList(document['stops']))
        chapters[readMap(stop)['id']] ??
            {
              'id': readMap(stop)['id'],
              'status': 'not_requested',
              'story': null,
              'audio': null,
              if (requested != null) 'localization': {'requestedLocale': requested, 'contentLocale': requested, 'fallbackReason': null},
            },
    ],
  };
  return requestedView(json, data.view.locale);
}
