import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/player/car/car_walk_controller.dart';
import 'package:otgolosok/features/player/walk_map_framing.dart';
import 'package:otgolosok/features/player/walk_player_controller.dart';
import 'package:otgolosok/features/player/walk_service_hub.dart';
import 'package:otgolosok/features/walks/route_map.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/walk_engine/driving_plan.dart';
import 'package:otgolosok/walk_engine/walk_session.dart' show InMemoryCheckpointStore;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../auth/harness.dart' show loadTranslations;
import 'fake_host.dart';

String _t(String source, Map<String, Object> values) => source;

Future<WalkPlayerController> _walk() async {
  SharedPreferences.setMockInitialValues({});
  final controller = WalkPlayerController(
    view: walkView(),
    link: const CatalogWalkLink('arbat'),
    hub: WalkServiceHub(FakeHost()),
    settings: SettingsStore(await SharedPreferences.getInstance()),
    origin: Uri.parse('https://otgolosok.online'),
    translations: loadTranslations(),
    locale: AppLocale.ru,
    localAudio: const {},
    reportLaunch: () {},
    onActiveChanged: (_) {},
    checkpoints: InMemoryCheckpointStore(),
  );
  addTearDown(controller.dispose);
  return controller;
}

WalkMapView _view(WalkMapFraming framing, WalkPlayerController walk, [int openingIndex = 0]) =>
    framing.view(route: walk.route, chapters: walk.chapters, state: walk.state, openingIndex: openingIndex, t: _t);

ws.Fix _fix(double lat, double lon) => ws.Fix(lat: lat, lon: lon, accuracyM: 8, timestampMs: 1000, provider: 'fused');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('before the start the map shows the way to the first stop, nothing highlighted', () async {
    final walk = await _walk();
    final view = _view(WalkMapFraming(), walk);
    expect(view.fit!.key, startsWith('opening:'));
    expect(view.activeLeg, isNull);
    expect(view.selectedId, isNull);
    expect(view.markers.map((marker) => marker.id), ['walk-start', ...walk.chapters.map((chapter) => chapter.id), 'walk-finish']);
  });

  test('a walk opened from a stop frames the leg into that stop', () async {
    final walk = await _walk();
    expect(_view(WalkMapFraming(), walk, 1).fit!.key, 'opening:1');
  });

  test('the walk highlights the current leg and its stop, and the first fix joins the frame once', () async {
    final walk = await _walk();
    final framing = WalkMapFraming();
    _view(framing, walk);
    await walk.start(locationGranted: true);

    final started = _view(framing, walk);
    expect(started.activeLeg, isNotNull);
    expect(started.selectedId, walk.chapters.first.id);
    expect(started.fit!.key, startsWith('leg:0:'));
    expect(started.fit!.key, isNot(endsWith(':user')));

    walk.onFix(_fix(55.7515, 37.5925));
    final located = _view(framing, walk);
    expect(located.fit!.key, '${started.fit!.key}:user');
    expect(located.user, isNotNull);

    // Later fixes move the dot, not the camera.
    walk.onFix(_fix(55.7517, 37.5927));
    expect(_view(framing, walk).fit!.key, located.fit!.key);
  });

  test('the same view comes back while nothing on the map changed', () async {
    final walk = await _walk();
    final framing = WalkMapFraming();
    final first = _view(framing, walk);
    expect(_view(framing, walk), same(first));
  });

  group('car walk', () {
    Future<CarWalkController> car() async {
      SharedPreferences.setMockInitialValues({});
      final controller = CarWalkController(
        view: carView(),
        link: const LocalWalkLink('7d3c6c1e-6a0e-4b8e-9c55-8a1f0c7a2b11'),
        hub: WalkServiceHub(FakeHost()),
        settings: SettingsStore(await SharedPreferences.getInstance()),
        origin: Uri.parse('https://otgolosok.online'),
        translations: loadTranslations(),
        locale: AppLocale.ru,
        reportLaunch: () {},
        onActiveChanged: (_) {},
      );
      addTearDown(controller.dispose);
      return controller;
    }

    final stops = carView().document.stops;
    WalkMapView carMap(CarMapFraming framing, CarWalkController trip) =>
        framing.view(car: trip.car!, stops: stops, state: trip.state, visit: trip.visit, t: _t);

    test('the overview shows the whole trip, the drive moves to the parking ahead', () async {
      final trip = await car();
      final framing = CarMapFraming();
      final overview = carMap(framing, trip);
      expect(overview.fit!.key, 'car-route');
      expect(overview.fit!.points, isNotEmpty);
      expect(overview.segments.where((segment) => segment.driving), isNotEmpty);
      expect(overview.selectedId, isNull);

      trip.transition(DrivingPlanAction.start);
      final driving = carMap(framing, trip);
      final parking = trip.visit!.parking;
      expect(driving.fit!.key, 'car-visit:${trip.visit!.id}');
      expect(driving.fit!.points, [parking.location]);
      expect(driving.selectedId, parking.id);
      expect(driving.markers.where((marker) => marker.parking).map((marker) => marker.id), contains(parking.id));
      expect(carMap(framing, trip), same(driving));
    });
  });
}
