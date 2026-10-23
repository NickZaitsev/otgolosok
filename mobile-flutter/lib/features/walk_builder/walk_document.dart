// Draft ⇄ walk document adapters of src/features/walks/adapters.ts. Documents are built as raw
// JSON maps and checked with the shared port of backend/walk-document.mjs before they are stored
// or sent, so the app never keeps a walk the server would reject.
import '../../walk_engine/car_route.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/walk_view.dart' show validateWalkDocumentJson;
import 'model.dart';

/// A version-2 walk document as JSON (`WalkDocument` of the site).
typedef WalkDocumentJson = Map<String, Object?>;

class InvalidWalkDocument implements Exception {
  const InvalidWalkDocument();

  /// Russian source text, as the server's BAD_REQUEST message.
  String get message => 'Некорректные данные прогулки.';

  @override
  String toString() => 'InvalidWalkDocument';
}

/// Throws [InvalidWalkDocument] unless [value] is a walk document the server accepts.
WalkDocumentJson validateWalkDocument(Object? value) {
  try {
    validateWalkDocumentJson(value);
  } on FormatException {
    throw const InvalidWalkDocument();
  }
  return value! as WalkDocumentJson;
}

String _stopIdFor(String walkId, int index) {
  final id = '$walkId-stop-$index';
  return id.length > 128 ? id.substring(0, 128) : id;
}

Map<String, Object?>? _jobFor(Place place, List<StoryRef> jobs) {
  final job = jobs.where((item) => placeKey(item.place) == placeKey(place) && isJobId(item.id)).firstOrNull;
  return job == null ? null : {'kind': 'job', 'id': job.id};
}

Map<String, Object?>? _storyFor(Place place, List<StoryRef> jobs) =>
    _jobFor(place, jobs) ?? (place.contentId != null ? {'kind': 'osm', 'id': place.contentId} : null);

Place _placeOf(Map<String, Object?> place) => Place(address: place['address']! as String, location: readPoint(place['location']));

/// `draftToWalkDocument`: the stored or account form of a draft; texts of [previous] stops are kept.
WalkDocumentJson draftToWalkDocument(Draft draft, String id, [WalkDocumentJson? previous]) {
  final oldByPlace = <String, Map<String, Object?>>{
    for (final stop in (previous?['stops'] as List<Object?>? ?? const []).cast<Map<String, Object?>>())
      placeKey(_placeOf(stop['place']! as Map<String, Object?>)): stop,
  };
  final startStory = !draft.driving && draft.start != null && _jobFor(draft.start!, draft.jobs) != null;
  final places = [if (startStory) draft.start!, ...draft.stops];
  final stops = <Map<String, Object?>>[];
  for (var index = 0; index < places.length; index++) {
    final place = places[index];
    final old = oldByPlace[placeKey(place)];
    stops.add({
      'id': old?['id'] ?? (draft.driving ? place.stopId : null) ?? _stopIdFor(id, index),
      'place': {'address': place.address, 'location': place.location.toJson()},
      'storyRef': _storyFor(place, draft.jobs),
      if (place.placeId != null) 'placeId': place.placeId,
      'transition': old?['transition'] ?? '',
      'nextHint': old?['nextHint'] ?? '',
      if (old?['triggerLocation'] != null) 'triggerLocation': Map<String, Object?>.of(old!['triggerLocation']! as Map<String, Object?>),
    });
  }
  final route = draft.route;
  final car = route?.car;
  return validateWalkDocument({
    'version': 2,
    'travelMode': draft.travelMode.name,
    'id': id,
    'title': draft.title.isEmpty ? 'Моя прогулка' : draft.title,
    'description': '',
    'city': 'Москва',
    if (draft.destination != null) 'destination': draft.destination!.toJson(),
    'mode': draft.mode.name,
    'minutes': draft.minutes,
    'start': draft.start == null ? null : {'address': draft.start!.address, 'location': draft.start!.location.toJson()},
    'stops': stops,
    'route': route == null
        ? null
        : {
            'geometry': [for (final point in route.geometry) point.toJson()],
            'distanceM': route.distanceM,
            'walkingMinutes': route.walkingMinutes,
            'attribution': route.attribution,
            if (route.tunnels != null) 'tunnels': [for (final (a, b) in route.tunnels!) [a, b]],
            if (car != null)
              'car': copyCarRoute(car, {
                for (var index = 0; index < draft.stops.length; index++)
                  if (draft.stops[index].stopId != null) draft.stops[index].stopId!: stops[index]['id']! as String,
              }).toJson(),
          },
    'fieldChecked': false,
  });
}

/// `walkDocumentToDraft`: a stored local or account walk opened in the builder.
Draft walkDocumentToDraft(WalkDocumentJson document, [List<StoryRef> previousJobs = const []]) {
  final driving = document['travelMode'] == 'driving';
  final stops = (document['stops']! as List<Object?>).cast<Map<String, Object?>>();
  final start = document['start'] == null ? null : _placeOf(document['start']! as Map<String, Object?>);
  final first = stops.firstOrNull;
  final firstIsStartStory = !driving &&
      start != null &&
      first != null &&
      _placeOf(first['place']! as Map<String, Object?>).location == start.location &&
      (first['storyRef'] as Map<String, Object?>?)?['kind'] == 'job';
  final routeStops = [for (var index = firstIsStartStory ? 1 : 0; index < stops.length; index++) stops[index]];
  final route = document['route'] as Map<String, Object?>?;
  final car = route?['car'] == null ? null : CarRoute.fromJson(route!['car']);
  Place toPlace(Map<String, Object?> stop) {
    final place = _placeOf(stop['place']! as Map<String, Object?>);
    final ref = stop['storyRef'] as Map<String, Object?>?;
    final id = stop['id']! as String;
    return Place(
      address: place.address,
      location: place.location,
      contentId: ref?['kind'] == 'osm' ? ref!['id']! as String : null,
      placeId: stop['placeId'] as String?,
      stopId: driving ? id : null,
      parkingId: driving ? car?.visits.where((visit) => visit.stopIds.contains(id)).firstOrNull?.parking.id : null,
    );
  }

  final places = routeStops.map(toPlace).toList();
  final tunnels = route?['tunnels'] as List<Object?>?;
  final minutes = (document['minutes']! as num).toInt();
  return Draft(
    travelMode: driving ? TravelMode.driving : TravelMode.walking,
    title: document['title']! as String,
    start: start,
    destination: document['destination'] == null ? null : Place.fromJson(document['destination']),
    mode: WalkMode.parse(document['mode'])!,
    minutes: minutes == 15 ? 30 : minutes,
    stops: places,
    route: route == null
        ? null
        : Plan(
            stops: places,
            geometry: readList(route['geometry']).map(readPoint).toList(),
            distanceM: route['distanceM']! as num,
            walkingMinutes: route['walkingMinutes']! as num,
            attribution: route['attribution']! as String,
            tunnels: tunnels?.map(readTunnel).toList(),
            car: car,
          ),
    jobs: [
      for (final stop in stops)
        if ((stop['storyRef'] as Map<String, Object?>?)?['kind'] == 'job' && isJobId((stop['storyRef']! as Map<String, Object?>)['id']))
          StoryRef(
            place: _placeOf(stop['place']! as Map<String, Object?>),
            id: (stop['storyRef']! as Map<String, Object?>)['id']! as String,
            stage: previousJobs.where((job) => job.id == (stop['storyRef']! as Map<String, Object?>)['id']).firstOrNull?.stage ?? GenerationStage.queued,
          ),
    ],
    submitting: null,
  );
}
