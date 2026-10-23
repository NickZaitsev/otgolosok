import '../../walk_engine/cities.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/walk_view.dart';
import '../walk_builder/model.dart' show isPlanIn;
import 'local_walks.dart';
import 'walk_loader.dart';

/// Why a walk cannot become a car walk; the message is Russian source text.
class CarCopyError implements Exception {
  const CarCopyError(this.message);
  final String message;

  @override
  String toString() => 'CarCopyError: $message';
}

const _notAllStops = CarCopyError('Не удалось сохранить все остановки автомобильной прогулки. Выберите другой маршрут.');

/// The document the car copy starts from: the original language version when the view is translated.
Map<String, Object?> _source(WalkViewData data) => readMap(data.json['sourceDocument'] ?? data.json['document']);

/// Whether «Пройти на машине» applies: a walking route with stops.
bool canCopyByCar(WalkViewData data) {
  final source = _source(data);
  return source['start'] != null && source['route'] != null && source['travelMode'] != 'driving' && readList(source['stops']).isNotEmpty;
}

/// The `/api/walk-plan` request for the car version of the walk (site `createCarCopy`).
Map<String, Object?> carPlanRequest(WalkViewData data) {
  if (!canCopyByCar(data)) throw const CarCopyError('Для этой прогулки нельзя построить автомобильный маршрут.');
  final source = _source(data);
  return {
    'travelMode': 'driving',
    'start': source['start'],
    'mode': source['mode'],
    'minutes': 180,
    if (source['destination'] != null) 'destination': source['destination'],
    'stops': [
      for (final stop in readList(source['stops'])) {...readMap(readMap(stop)['place']), 'stopId': readMap(stop)['id']},
    ],
  };
}

/// A new local document that keeps the story references of the source; the published walk stays
/// intact (site `carCopyDocument`).
WalkDocument carCopyDocument(WalkViewData data, Object? plan, String id) {
  final source = _source(data);
  final stops = readList(source['stops']).map(readMap).toList();
  final city = source['city'];
  if (!canCopyByCar(data) || !isPlanIn(plan, (lat, lon) => cityAt(lat, lon)?.name == city)) throw _notAllStops;
  final planMap = readMap(plan);
  final car = planMap['car'];
  final planStops = readList(planMap['stops']).map(readMap).toList();
  if (car == null || planStops.length != stops.length || CarRoute.fromJson(car).totalMinutes > 180) throw _notAllStops;
  for (var index = 0; index < stops.length; index++) {
    final location = readMap(planStops[index]['location']);
    final expected = readMap(readMap(stops[index]['place'])['location']);
    if (planStops[index]['stopId'] != stops[index]['id'] || location['lat'] != expected['lat'] || location['lon'] != expected['lon']) {
      throw _notAllStops;
    }
  }
  final document = <String, Object?>{
    ...source,
    'id': id,
    'travelMode': 'driving',
    'minutes': 180,
    'route': {
      'geometry': planMap['geometry'],
      'distanceM': planMap['distanceM'],
      'walkingMinutes': planMap['walkingMinutes'],
      'attribution': planMap['attribution'],
      'car': copyCarRoute(CarRoute.fromJson(car)).toJson(),
    },
    // Pedestrian arrival hints are no longer reliable after road routing.
    'stops': [for (final stop in stops) {...stop, 'transition': '', 'nextHint': ''}],
    'fieldChecked': false,
  };
  try {
    return WalkDocument.fromJson(document);
  } on FormatException {
    throw _notAllStops;
  }
}

/// Plans the car route and saves the copy on the device; returns the new local walk id.
Future<String> createCarCopy(
  WalkViewData data, {
  required Future<Object?> Function(Map<String, Object?> body) plan,
  required LocalWalkStore store,
  required String Function() newId,
}) async {
  final answer = await plan(carPlanRequest(data));
  final document = carCopyDocument(data, answer, newId());
  return (await store.save(document)).id;
}
