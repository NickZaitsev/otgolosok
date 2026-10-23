import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walks/car_copy.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:otgolosok/features/walks/walk_loader.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'support.dart';

class _Store implements LocalWalkStore {
  final saved = <WalkDocument>[];

  @override
  Future<LocalWalk?> get(String id) async => null;

  @override
  Future<List<LocalWalk>> list() async => const [];

  @override
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision}) async {
    saved.add(document);
    return LocalWalk(document: document, revision: 0);
  }
}

Map<String, Object?> _copy(Object? json) => jsonDecode(jsonEncode(json)) as Map<String, Object?>;

/// The fixture's car walk as the walking walk it was planned from, opened as a view.
WalkViewData _walking() {
  final car = fixtureInput('walk_view.json', 'documents', 'valid car walk');
  // On foot the same points make a shorter route than by car (a walking route stays within 8.1 km).
  final route = _copy(car['route'])
    ..remove('car')
    ..['distanceM'] = 4000
    ..['walkingMinutes'] = 50;
  final document = {...car, 'route': route, 'id': 'center', 'minutes': 60}..remove('travelMode');
  final json = sampleView();
  json['document'] = document;
  json['chapters'] = [
    {'id': 'car-stop-1', 'status': 'preparing', 'story': null, 'audio': null},
  ];
  return WalkViewData(WalkView.fromJson(json), json);
}

/// The planner's answer: the car route of the fixture for the same stop.
Map<String, Object?> _plan() {
  final car = fixtureInput('walk_view.json', 'documents', 'valid car walk');
  final route = _copy(car['route']);
  final stop = _copy((car['stops']! as List<Object?>).first);
  return {...route, 'stops': [{...(stop['place']! as Map<String, Object?>), 'stopId': stop['id']}]};
}

void main() {
  test('the car plan asks for three hours by car through the same stops', () {
    final request = carPlanRequest(_walking());
    expect(request['travelMode'], 'driving');
    expect(request['minutes'], 180);
    expect(request['mode'], 'open');
    expect((request['stops']! as List<Object?>).single, containsPair('stopId', 'car-stop-1'));
  });

  test('a matching plan becomes a local car walk that keeps the stories', () async {
    final store = _Store();
    final id = await createCarCopy(_walking(), plan: (_) async => _plan(), store: store, newId: () => 'copy-1');
    expect(id, 'copy-1');
    final document = store.saved.single;
    expect(document.driving, isTrue);
    expect(document.minutes, 180);
    expect(document.route?.car?.totalMinutes, 33);
    expect(document.stops.single.id, 'car-stop-1');
    expect(document.stops.single.transition, '');
  });

  group('a plan that does not fit is refused', () {
    final table = <String, Map<String, Object?> Function()>{
      'no car route': () => _plan()..remove('car'),
      'a stop is missing': () => _plan()..['stops'] = <Object?>[],
      'another stop id': () {
        final plan = _plan();
        ((plan['stops']! as List<Object?>).single! as Map<String, Object?>)['stopId'] = 'other';
        return plan;
      },
      'a moved stop': () {
        final plan = _plan();
        ((plan['stops']! as List<Object?>).single! as Map<String, Object?>)['location'] = {'lat': 55.77, 'lon': 37.64};
        return plan;
      },
      'over three hours': () {
        final plan = _plan();
        (plan['car']! as Map<String, Object?>)['totalMinutes'] = 181;
        return plan;
      },
      'outside the city': () {
        final plan = _plan();
        plan['geometry'] = [
          {'lat': 59.93, 'lon': 30.31},
          {'lat': 59.94, 'lon': 30.32},
        ];
        return plan;
      },
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () {
        expect(
          () => carCopyDocument(_walking(), value(), 'copy-1'),
          throwsA(isA<CarCopyError>().having((e) => e.message, 'message', startsWith('Не удалось сохранить все остановки'))),
        );
      });
    }
  });

  test('a car walk is not copied by car again', () {
    final json = sampleView();
    final data = WalkViewData(WalkView.fromJson(json), json);
    expect(canCopyByCar(data), isTrue);
    final car = _walking();
    (car.json['document']! as Map<String, Object?>)['travelMode'] = 'driving';
    expect(canCopyByCar(car), isFalse);
    expect(() => carPlanRequest(car), throwsA(isA<CarCopyError>()));
  });
}
