import '../../walk_engine/car_route.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/driving_plan.dart';
import '../../walk_engine/route.dart';
import '../../walk_engine/route_legs.dart';
import '../../walk_engine/walk_plan.dart';
import '../../walk_engine/walk_session.dart';
import '../../walk_engine/walk_view.dart' show TunnelRange, WalkStop;
import '../walk_builder/builder_map.dart' show BuilderMarker;
import '../walks/route_map.dart';

typedef MapText = String Function(String source, Map<String, Object> values);

/// What the walk map shows for the walk's state (site `walk-session.tsx`): before the first start
/// the start, the first leg and the first stop; during the walk the leg to walk now, highlighted
/// and framed, with the walker's position joining the frame once when it first arrives. After the
/// walk stops the map stays where the walk left it.
///
/// The same [WalkMapView] instance comes back while nothing the map draws has changed, so the map
/// is not redrawn on every playback tick.
class WalkMapFraming {
  Route? _route;
  List<RouteChapter>? _chapters;
  List<GeoPoint> _geometry = const [];
  List<GeoPoint> _stops = const [];
  List<int> _cuts = const [];

  bool _walked = false;
  String? _legKey;
  MapFit? _legFit;
  bool _waiting = false;
  bool _refined = false;

  WalkMapView? _view;
  Object? _inputs;

  WalkMapView view({
    required Route route,
    required List<RouteChapter> chapters,
    required WalkUiState state,
    required int openingIndex,
    required MapText t,
  }) {
    // The session hands out a fresh copy of its chapter list on every read.
    if (!identical(route, _route) || !_sameChapters(chapters)) {
      _route = route;
      _chapters = chapters;
      _geometry = route.walk?.path.coordinates ?? const [];
      _stops = [for (final chapter in chapters) chapter.arrivalPoint];
      _cuts = routeLegCuts(_geometry, _stops);
    }
    final active = state.active;
    if (active) _walked = true;
    final user = state.lastFix == null ? null : GeoPoint(state.lastFix!.lat, state.lastFix!.lon);
    final leg = state.leg;
    final legPath = active ? legRange(_cuts, _geometry.length, leg) : null;
    final legEnd = leg < _stops.length ? _stops[leg] : route.walk?.finish.location;
    final legKey = active && legEnd != null ? '$leg:${legPath?.$1}-${legPath?.$2}' : null;
    if (legKey != _legKey) {
      _legKey = legKey;
      if (legKey == null || legEnd == null) {
        _legFit = null;
        _waiting = false;
        _refined = false;
      } else {
        final fit = legFitPoints(_geometry, legPath, legEnd, user);
        _legFit = MapFit('leg:$legKey', fit.points);
        _waiting = !fit.withUser;
      }
    } else if (_waiting && user != null && legEnd != null) {
      // The first fix after a fit without it refines that fit, once per walk.
      _waiting = false;
      final fit = legFitPoints(_geometry, legPath, legEnd, user);
      if (fit.withUser && !_refined) _legFit = MapFit('leg:$legKey:user', fit.points);
      _refined = true;
    }
    final fit = _walked || state.completed ? _legFit : _opening(route, openingIndex);
    final selectedId = active && state.chapterIndex >= 0 && state.chapterIndex < chapters.length ? chapters[state.chapterIndex].id : null;
    final inputs = (route, _chapters, legPath, selectedId, user, fit?.key);
    if (_view != null && inputs == _inputs) return _view!;
    _inputs = inputs;
    final walk = route.walk;
    return _view = WalkMapView(
      markers: [
        if (walk != null) BuilderMarker(id: 'walk-start', title: t('Старт: {address}', {'address': walk.start.address}), location: walk.start.location, endpoint: true),
        for (final (index, chapter) in chapters.indexed)
          BuilderMarker(
            id: chapter.id,
            title: t('Остановка {number}: {title}', {'number': index + 1, 'title': chapter.title}),
            location: chapter.arrivalPoint,
            number: index + 1,
          ),
        if (walk != null) BuilderMarker(id: 'walk-finish', title: t('Финиш: {address}', {'address': walk.finish.address}), location: walk.finish.location, endpoint: true),
      ],
      geometry: _geometry,
      tunnels: [for (final range in walk?.path.tunnels ?? const <TunnelRange>[]) (range.start, range.end)],
      activeLeg: legPath,
      selectedId: selectedId,
      user: user,
      fit: fit,
    );
  }

  bool _sameChapters(List<RouteChapter> chapters) {
    final known = _chapters;
    if (known == null || known.length != chapters.length) return false;
    for (var i = 0; i < chapters.length; i++) {
      if (!identical(known[i], chapters[i])) return false;
    }
    return true;
  }

  MapFit? _opening(Route route, int openingIndex) {
    final start = route.walk?.start.location;
    if (start == null) return null;
    // A walk without stops shows its whole route.
    if (_stops.isEmpty) return MapFit('route', _geometry.length > 1 ? _geometry : [start]);
    final index = openingIndex.clamp(0, _stops.length - 1);
    if (index > 0) {
      return MapFit('opening:$index', legFitPoints(_geometry, legRange(_cuts, _geometry.length, index), _stops[index], null).points);
    }
    // Keyed by the first stop, so a reversed walk opens on its own first leg.
    return MapFit('opening:${_stops.first.lat},${_stops.first.lon}', openingFitPoints(_geometry, _cuts, start, _stops.first));
  }
}

/// What a car walk's map shows (site `DrivingExperience`): drives and walks on foot, parkings and
/// stories; the whole route at the overview and the finish, the current parking during the trip.
class CarMapFraming {
  WalkMapView? _view;
  Object? _inputs;

  WalkMapView view({
    required CarRoute car,
    required List<WalkStop> stops,
    required DrivingPlanState state,
    required ParkingVisit? visit,
    required MapText t,
  }) {
    final overview = state is DrivingOverview || state is DrivingComplete;
    final fit = overview
        ? MapFit('car-route', [for (final segment in car.segments) ...segment.geometry])
        : visit == null
            ? null
            : MapFit('car-visit:${visit.id}', [visit.parking.location]);
    final inputs = (car, stops, visit?.id, fit?.key);
    if (_view != null && inputs == _inputs) return _view!;
    _inputs = inputs;
    return _view = WalkMapView(
      markers: [
        for (final (index, item) in car.visits.indexed)
          BuilderMarker(id: item.parking.id, title: t('Парковка {current}', {'current': index + 1}), location: item.parking.location, parking: true),
        for (final (index, stop) in stops.indexed)
          BuilderMarker(id: stop.id, title: stop.place.address, location: stop.triggerLocation ?? stop.place.location, number: index + 1),
      ],
      segments: [for (final segment in car.segments) (driving: segment.mode == TravelSegmentMode.driving, geometry: segment.geometry)],
      selectedId: visit?.parking.id,
      fit: fit,
    );
  }
}
