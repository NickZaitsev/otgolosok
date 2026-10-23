import 'dart:convert';
import 'dart:io';

import 'package:otgolosok/core/auth/session.dart';
import 'package:otgolosok/features/walk_builder/builder_api.dart';
import 'package:otgolosok/features/walk_builder/builder_controller.dart';
import 'package:otgolosok/features/walk_builder/builder_storage.dart';
import 'package:otgolosok/features/walk_builder/model.dart';
import 'package:otgolosok/features/walk_builder/throttle.dart';
import 'package:otgolosok/walk_engine/distance.dart';

import '../auth/harness.dart';

/// Time that moves only when the code under test sleeps.
class FakeClock implements Clock {
  DateTime _now = DateTime.utc(2026, 10, 23, 12);
  final sleeps = <Duration>[];

  @override
  DateTime now() => _now;

  void advance(Duration duration) => _now = _now.add(duration);

  @override
  Future<void> sleep(Duration duration) async {
    sleeps.add(duration);
    _now = _now.add(duration);
    // Lets other tasks run, like a real timer would.
    await Future<void>.delayed(Duration.zero);
  }
}

Map<String, Object?> fixture(String name) => jsonDecode(File('test/fixtures/api/$name').readAsStringSync()) as Map<String, Object?>;

/// The valid plan of the fixture: one stop, «Москва, Арбат, 10», six minutes on foot.
Map<String, Object?> validPlan() {
  final plans = (fixture('walk_builder.json')['plans']! as List<Object?>).cast<Map<String, Object?>>();
  return plans.firstWhere((item) => item['name'] == 'valid')['input']! as Map<String, Object?>;
}

const startPlace = Place(address: 'Москва, Арбат, 1', location: GeoPoint(55.7515, 37.5925));
const otherPlace = Place(address: 'Москва, Тверская улица, 7', location: GeoPoint(55.7579, 37.6136));

Map<String, Object?> placeJson(Place place) => place.toJson();

const jobId = '11111111-2222-4333-8444-555555555555';
const walkId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

Map<String, Object?> accountWalkJson({String id = walkId, int revision = 0, String visibility = 'private', String? listingStatus, Object? snapshot}) => {
      'id': id,
      'title': 'Прогулка от Москва, Арбат, 1',
      'revision': revision,
      'visibility': visibility,
      'listingStatus': ?listingStatus,
      'shareToken': visibility == 'private' ? null : '901d1133-44a2-4724-a856-2fe8d6c86a44',
      'snapshot': snapshot,
    };

/// A controller over the harness API, memory storage and a fake clock.
class Setup {
  Setup({this.user, BuilderArgs args = const BuilderArgs(resume: true), MemoryBuilderStorage? storage, this.sessionFails = false})
      : storage = storage ?? MemoryBuilderStorage() {
    walks = DeviceLocalWalkStore(this.storage, now: clock.now);
    controller = BuilderController(
      BuilderServices(
        api: BuilderApi(harness.api, clock: clock),
        storage: this.storage,
        walks: walks,
        session: () async {
          if (sessionFails) throw StateError('offline');
          return user;
        },
        preferredTravelMode: () => TravelMode.walking,
        clock: clock,
        uuid: () => 'cccccccc-dddd-4eee-8fff-${(++_uuids).toString().padLeft(12, '0')}',
      ),
      args,
    );
  }

  final harness = Harness();
  final clock = FakeClock();
  final MemoryBuilderStorage storage;
  final bool sessionFails;

  /// The signed-in user the session check answers.
  final AuthUser? user;
  late final DeviceLocalWalkStore walks;
  late final BuilderController controller;
  int _uuids = 0;

  FakeServer get server => harness.server;
}

const user = AuthUser(id: 'user-1', name: 'Анна Петрова');

/// A walking draft from [startPlace], as the builder stores it.
Draft startDraft({Plan? route, List<Place> stops = const [], List<StoryRef> jobs = const [], Place? submitting}) => Draft.empty().copyWith(
      title: 'Прогулка от ${startPlace.address}',
      start: const Value(startPlace),
      stops: stops,
      route: Value(route),
      jobs: jobs,
      submitting: Value(submitting),
    );

/// The fixture plan as the draft keeps it.
Plan fixturePlan() => Plan.fromJson(validPlan());
