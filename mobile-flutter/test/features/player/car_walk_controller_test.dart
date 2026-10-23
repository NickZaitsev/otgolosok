import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/player/car/car_walk_controller.dart';
import 'package:otgolosok/features/player/car/car_walk_panel.dart';
import 'package:otgolosok/features/player/walk_service_hub.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/driving_plan.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../auth/harness.dart' show loadTranslations;
import 'fake_host.dart';

const _link = LocalWalkLink('7d3c6c1e-6a0e-4b8e-9c55-8a1f0c7a2b11');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final translations = loadTranslations();
  late FakeHost host;
  late WalkServiceHub hub;
  late SettingsStore settings;
  late List<bool> active;
  late int launches;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    settings = SettingsStore(await SharedPreferences.getInstance());
    host = FakeHost();
    hub = WalkServiceHub(host);
    active = [];
    launches = 0;
  });

  CarWalkController car() {
    final controller = CarWalkController(
      view: carView(),
      link: _link,
      hub: hub,
      settings: settings,
      origin: Uri.parse('https://otgolosok.online'),
      translations: translations,
      locale: AppLocale.ru,
      reportLaunch: () => launches += 1,
      onActiveChanged: active.add,
    );
    addTearDown(controller.dispose);
    return controller;
  }

  test('a story plays only after parking, in a session without tracking', () async {
    final trip = car();
    expect(trip.state, isA<DrivingOverview>());
    trip.transition(DrivingPlanAction.start);
    expect(trip.state, isA<DrivingToVisit>());
    expect(launches, 1);
    expect(active, [true]);
    // On the road there is nothing to play.
    expect(trip.storySource, isNull);
    await trip.toggle();
    expect(host.calls, isEmpty);

    trip.transition(DrivingPlanAction.parked);
    expect(trip.state, const DrivingVisiting(0, 0));
    expect(trip.chapter?.id, 'car-stop-1');
    await trip.toggle();
    await pumpEventQueue();
    final config = host.sessions.single;
    expect(config.kind, ws.SessionKind.listen);
    expect(config.tracking, isFalse);
    expect(config.contentRoute, '/walk?local=7d3c6c1e-6a0e-4b8e-9c55-8a1f0c7a2b11');
    final track = host.tracks.single;
    expect(track.id, audioOf('a'));
    expect(track.uri, 'https://otgolosok.online${audioOf('a')}');
    expect(track.album, 'На машине по городу');

    hub.onPlayer(ws.PlayerState(trackId: audioOf('a'), state: ws.PlaybackState.playing, positionMs: 4000, durationMs: 60000));
    expect(trip.audio.playing, isTrue);
    await trip.toggle();
    await pumpEventQueue();
    expect(host.calls.last, 'pause');

    // Back to the car: the story stops and the service goes away.
    trip.transition(DrivingPlanAction.returnToCar);
    await pumpEventQueue();
    expect(trip.state, const DrivingReturning(0));
    expect(host.count('stopSession'), 1);
    expect(hub.owner, isNull);
    expect(trip.audio.playing, isFalse);
  });

  test('the trip is saved on every step and restored on the next opening', () async {
    final trip = car();
    trip
      ..transition(DrivingPlanAction.start)
      ..transition(DrivingPlanAction.parked);
    await pumpEventQueue();
    final again = car();
    expect(again.state, const DrivingVisiting(0, 0));
    await pumpEventQueue();
    expect(active.last, isTrue);
    again
      ..transition(DrivingPlanAction.returnToCar)
      ..transition(DrivingPlanAction.atCar);
    // No destination: the trip is over after the last parking, and its progress is cleared.
    expect(again.state, isA<DrivingComplete>());
    await pumpEventQueue();
    expect(settings.readString(drivingProgressKey('car-walk')), isNull);
    expect(active.last, isFalse);
  });

  test('a player failure keeps the visit and shows the site text', () async {
    host.refusals['play'] = ['player_error'];
    final trip = car()
      ..transition(DrivingPlanAction.start)
      ..transition(DrivingPlanAction.parked);
    await trip.toggle();
    await pumpEventQueue();
    expect(trip.audio.error, 'Не удалось воспроизвести аудио. Попробуйте запустить его ещё раз.');
    expect(trip.state, const DrivingVisiting(0, 0));
  });

  test('the lock-screen stop ends the story, not the trip', () async {
    final trip = car()
      ..transition(DrivingPlanAction.start)
      ..transition(DrivingPlanAction.parked);
    await trip.toggle();
    hub.onMediaCommand(ws.MediaCommand(kind: ws.MediaCommandKind.stop));
    await pumpEventQueue();
    expect(hub.owner, isNull);
    expect(host.count('stopSession'), 1);
    expect(trip.state, const DrivingVisiting(0, 0));
  });

  test('navigation links open Yandex routes by car and on foot', () {
    final car = yandexNavigationUrl(const GeoPoint(55.76, 37.63), driving: true);
    expect('${car.origin}${car.path}', 'https://yandex.ru/maps/');
    expect(car.queryParameters, {'rtext': '~55.76,37.63', 'rtt': 'auto'});
    expect(yandexNavigationUrl(const GeoPoint(55.76, 37.63), driving: false).queryParameters['rtt'], 'pd');
  });
}
