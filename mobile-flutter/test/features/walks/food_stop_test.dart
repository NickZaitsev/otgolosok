import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/walk_builder/model.dart' show Place, Plan;
import 'package:otgolosok/features/walks/food_stop.dart';
import 'package:otgolosok/features/walks/walk_loader.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'support.dart';

// A straight walk north along one meridian: vertex i lies i × ~111 m from the start.
const _lon = 37.6;
GeoPoint at(int i) => GeoPoint(55.75 + i * 0.001, _lon);
Map<String, Object?> _point(GeoPoint point) => point.toJson();

Map<String, Object?> _stop(String id, int i, [String hint = '']) =>
    {'id': id, 'place': {'address': id, 'location': _point(at(i))}, 'storyRef': null, 'transition': hint, 'nextHint': hint};

Map<String, Object?> _walk([Map<String, Object?> overrides = const {}]) => {
      'version': 2, 'id': 'walk-1', 'title': 'Прогулка', 'description': '', 'city': 'Москва', 'mode': 'open', 'minutes': 30,
      'start': {'address': 'Старт', 'location': _point(at(0))},
      'destination': {'address': 'Финиш', 'location': _point(at(10))},
      'stops': [_stop('a', 3, 'Идите к b'), _stop('b', 6, 'Идите к финишу')],
      'route': {
        'geometry': [for (var i = 0; i <= 10; i++) _point(at(i))],
        'distanceM': 1100, 'walkingMinutes': 14, 'attribution': '© OSM',
        'tunnels': [[1, 2], [7, 9]],
      },
      'fieldChecked': false,
      ...overrides,
    };

Map<String, Object?> _route([Map<String, Object?> overrides = const {}]) => {...(_walk()['route']! as Map<String, Object?>), ...overrides};

WalkDocument _doc([Map<String, Object?> overrides = const {}]) => WalkDocument.fromJson(_walk(overrides));

// A venue 60 m east of the line beside vertex `i`.
FoodPlace venue(int i, [String name = 'Кофейня']) =>
    FoodPlace(id: 'osm:node:$i', kind: FoodKind.coffee, name: name, lat: at(i).lat + 0.0002, lon: _lon + 0.001);

// A venue on the line itself.
final _kiosk = FoodPlace(id: 'osm:node:9', kind: FoodKind.coffee, name: 'Киоск', lat: at(4).lat, lon: _lon);

// The way the router returns from `from` through the venue to `to`.
Plan way(int from, int to, FoodPlace place, {List<GeoPoint>? geometry, num distanceM = 400, num walkingMinutes = 5, List<(int, int)>? tunnels = const [(0, 1)]}) => Plan(
      stops: [Place(address: place.name, location: place.location)],
      geometry: geometry ?? [at(from), place.location, at(to)],
      distanceM: distanceM,
      walkingMinutes: walkingMinutes,
      attribution: '© OSM',
      tunnels: tunnels,
    );

Matcher _refusal(String message) => isA<FoodStopError>().having((error) => error.message, 'message', message);

FoodStopLeg _leg(int position, int a, int b) => FoodStopLeg(position: position, range: (a, b), from: at(a), to: at(b));

void main() {
  group('место заведения в прогулке', () {
    test('автомобильный документ отклоняется до расчёта пешеходного участка', () {
      final car = fixtureInput('walk_view.json', 'documents', 'valid car walk');
      final original = jsonEncode(car);
      expect(() => foodStopLeg(WalkDocument.fromJson(car), venue(4).location), throwsA(_refusal('Добавление заведения пока доступно только для пешеходных прогулок.')));
      expect(() => insertFoodStop(car, venue(4), _leg(0, 0, 1), null, 'cafe'), throwsA(isA<FoodStopError>()));
      expect(jsonEncode(car), original);
    });

    test('метаданные парковок без режима поездки тоже отклоняются', () {
      final car = fixtureInput('walk_view.json', 'documents', 'valid car walk');
      final document = _walk({'route': _route({'car': (car['route']! as Map<String, Object?>)['car']})});
      final place = venue(4);
      expect(() => insertFoodStop(document, place, _leg(0, 0, 1), way(0, 1, place), 'cafe'), throwsA(isA<FoodStopError>()));
    });

    test('режим поездки без готового маршрута отклоняется', () {
      final document = _walk({'travelMode': 'driving', 'minutes': 60, 'route': null});
      final place = venue(4);
      expect(() => foodStopLeg(WalkDocument.fromJson(document), place.location), throwsA(isA<FoodStopError>()));
      expect(() => insertFoodStop(document, place, _leg(0, 0, 1), way(0, 1, place), 'cafe'), throwsA(isA<FoodStopError>()));
    });

    final legs = <(String, int, int, (int, int))>[
      ('до первой остановки', 1, 0, (0, 3)),
      ('между остановками', 4, 1, (3, 6)),
      ('после последней остановки, на пути к финишу', 8, 2, (6, 10)),
    ];
    for (final (name, vertex, position, range) in legs) {
      test(name, () {
        expect(foodStopLeg(_doc(), venue(vertex).location), FoodStopLeg(position: position, range: range, from: at(range.$1), to: at(range.$2)));
      });
    }

    test('путь идёт от предыдущей остановки через заведение к следующей', () {
      final place = venue(4);
      expect(foodLegRequest(foodStopLeg(_doc(), place.location), place), {
        'start': {'address': 'Точка маршрута', 'location': _point(at(3))},
        'mode': 'open',
        'minutes': 90,
        'stops': [
          {'address': 'Кофейня', 'location': _point(place.location)},
        ],
        'destination': {'address': 'Точка маршрута', 'location': _point(at(6))},
      });
    });

    test('участок без длины превращается в маленькую петлю', () {
      final request = foodLegRequest(_leg(2, 10, 10), venue(10))!;
      expect(request['mode'], 'loop');
      expect(request['start'], {'address': 'Точка маршрута', 'location': _point(at(10))});
      expect(request.containsKey('destination'), isFalse);
    });

    test('последний отрезок до остановки на финише относится к пути к ней', () {
      final document = _doc({'destination': null, 'stops': [_stop('a', 3), _stop('b', 10)]});
      final leg = foodStopLeg(document, venue(10).location);
      expect((leg.position, leg.range), (1, (3, 10)));
    });

    test('заведению на самой линии новый путь не нужен', () {
      expect(foodLegRequest(_leg(1, 4, 6), _kiosk), isNull);
    });

    final refusals = <(String, Map<String, Object?>, String)>[
      ('без маршрута', {'route': null}, 'У прогулки ещё нет маршрута.'),
      (
        'уже добавленное',
        {
          'stops': [
            _stop('a', 3),
            {..._stop('cafe', 0), 'place': {'address': 'Кофейня', 'location': _point(venue(4).location)}},
          ],
        },
        'Заведение уже есть в прогулке.',
      ),
      ('в полной прогулке', {'stops': [for (var i = 0; i < 40; i++) _stop('s$i', 3)]}, 'В прогулке уже 40 остановок — больше добавить нельзя.'),
    ];
    for (final (name, overrides, message) in refusals) {
      test('отказ: $name', () {
        expect(() => foodStopLeg(_doc(overrides), venue(4).location), throwsA(_refusal(message)));
      });
    }
  });

  group('вставка заведения', () {
    test('путь вшивается вместо участка, остальной маршрут, туннели и остановки сохраняются', () {
      final json = _walk(), before = jsonEncode(json), place = venue(4);
      final leg = foodStopLeg(WalkDocument.fromJson(json), place.location);
      final result = WalkDocument.fromJson(insertFoodStop(json, place, leg, way(3, 6, place), 'cafe-1'));
      final route = result.route!;
      // Vertices 0..3, the venue, then 6..10: the old stretch 4..5 is gone.
      expect(route.geometry, [at(0), at(1), at(2), at(3), place.location, at(6), at(7), at(8), at(9), at(10)]);
      // The old tunnel before the leg stays, the new way's tunnel follows it, the one after shifts by −1.
      expect(route.tunnels, const [TunnelRange(1, 2), TunnelRange(3, 4), TunnelRange(6, 8)]);
      // 3 of 10 segments (330 of 1100 m) are replaced by the 400 m way.
      expect(route.distanceM, 1170);
      expect(route.walkingMinutes, (14 * 0.7 + 5).ceil());
      expect([for (final stop in result.stops) stop.id], ['a', 'cafe-1', 'b']);
      final cafe = result.stops[1];
      expect((cafe.place.address, cafe.place.location, cafe.storyRef, cafe.transition, cafe.nextHint), ('Кофейня', place.location, null, '', ''));
      // The hint of the stop before the venue led past it; the next stop keeps its own.
      expect((result.stops[0].transition, result.stops[0].nextHint), ('', ''));
      expect((result.stops[2].transition, result.stops[2].nextHint), ('Идите к финишу', 'Идите к финишу'));
      expect(hasFoodStop(result, place.location), isTrue);
      expect(jsonEncode(json), before);
    });

    test('туннель, который пересекает участок, обрезается по его краям', () {
      final json = _walk({'route': _route({'tunnels': [[2, 8]]})}), place = venue(4);
      final leg = foodStopLeg(WalkDocument.fromJson(json), place.location);
      final result = insertFoodStop(json, place, leg, way(3, 6, place, tunnels: null), 'cafe-1');
      expect((result['route']! as Map<String, Object?>)['tunnels'], [[2, 3], [5, 7]]);
    });

    test('путь, который начинается в нескольких метрах от линии, сохраняет обе точки стыка', () {
      // A joint within 10 m keeps the old vertex and the way's own first point; an exact joint keeps one.
      final json = _walk({'route': _route({'tunnels': null})..remove('tunnels')}), place = venue(4);
      final start = GeoPoint(at(3).lat, _lon + 0.00005);
      final leg = foodStopLeg(WalkDocument.fromJson(json), place.location);
      final result = WalkDocument.fromJson(insertFoodStop(json, place, leg, way(3, 6, place, geometry: [start, place.location, at(6)], tunnels: null), 'cafe-1'));
      expect(result.route!.geometry, [at(0), at(1), at(2), at(3), start, place.location, at(6), at(7), at(8), at(9), at(10)]);
      expect(result.route!.tunnels, isNull);
    });

    test('заведение на линии добавляется без изменения маршрута', () {
      final json = _walk();
      final leg = foodStopLeg(WalkDocument.fromJson(json), _kiosk.location);
      final result = insertFoodStop(json, _kiosk, leg, null, 'cafe-1');
      expect(jsonEncode(result['route']), jsonEncode(json['route']));
      expect([for (final stop in result['stops']! as List<Object?>) (stop! as Map<String, Object?>)['id']], ['a', 'cafe-1', 'b']);
    });

    test('длинная прогулка переходит на следующую длительность конструктора', () {
      final json = _walk({'minutes': 15}), place = venue(4);
      final leg = foodStopLeg(WalkDocument.fromJson(json), place.location);
      final result = WalkDocument.fromJson(insertFoodStop(json, place, leg, way(3, 6, place, walkingMinutes: 20), 'cafe-1'));
      expect(result.route!.walkingMinutes, 30);
      expect(result.minutes, 30);
    });

    final refusals = <(String, Plan Function(FoodPlace), String)>[
      ('разрыв в начале пути', (place) => way(3, 6, place, geometry: [GeoPoint(at(3).lat, _lon + 0.0005), at(6)]), 'Не удалось соединить путь к заведению с маршрутом.'),
      ('разрыв в конце пути', (place) => way(3, 6, place, geometry: [at(3), GeoPoint(at(6).lat, _lon + 0.0005)]), 'Не удалось соединить путь к заведению с маршрутом.'),
      ('прогулка длиннее 90 минут', (place) => way(3, 6, place, walkingMinutes: 85), 'С этим заведением прогулка станет длиннее 90 минут.'),
      ('маршрут длиннее 8,1 км', (place) => way(3, 6, place, distanceM: 7800), 'С этим заведением прогулка станет длиннее 90 минут.'),
    ];
    for (final (name, plan, message) in refusals) {
      test('отказ: $name', () {
        final json = _walk(), place = venue(4);
        final leg = foodStopLeg(WalkDocument.fromJson(json), place.location);
        expect(() => insertFoodStop(json, place, leg, plan(place), 'cafe-1'), throwsA(_refusal(message)));
      });
    }

    final titles = <(String, String)>[
      ('Кофейня «Утро»', 'Кофейня «Утро»'),
      ('  Бар <b>Ночь</b>​ ', 'Бар b Ночь /b'),
      ('я' * 200, '${'я' * 179}…'),
      ('😀' * 181, '${'😀' * 179}…'),
      ('😀' * 180, '😀' * 180),
      ('<>', 'Кофейня'),
    ];
    for (final (name, title) in titles) {
      test('название ${jsonEncode(name.length > 20 ? '${name.substring(0, 2)}…×${name.runes.length}' : name)} становится остановкой', () {
        expect(foodStopTitle(name, FoodKind.coffee), title);
      });
    }

    test('новая остановка получает пустую главу, остальные сохраняют истории', () {
      final json = _walk(), place = venue(4);
      final chapterA = {'id': 'a', 'status': 'preparing', 'story': null, 'audio': null};
      final chapterB = {'id': 'b', 'status': 'failed', 'story': null, 'audio': null};
      final viewJson = <String, Object?>{'document': json, 'revision': 3, 'contentVersion': 'v', 'chapters': [chapterA, chapterB]};
      final data = WalkViewData(WalkView.fromJson(viewJson), viewJson);
      final changed = insertFoodStop(json, place, foodStopLeg(data.view.document, place.location), way(3, 6, place), 'cafe-1');
      final result = viewWithDocument(data, changed, 4, 'local:4');
      expect(result.json['chapters'], [chapterA, {'id': 'cafe-1', 'status': 'not_requested', 'story': null, 'audio': null}, chapterB]);
      expect((result.view.revision, result.view.contentVersion, result.view.document.stops.length), (4, 'local:4', 3));
    });

    test('переведённая прогулка остаётся на своём языке с устаревшим русским документом', () {
      final view = sampleEnglishView();
      final data = WalkViewData(WalkView.fromJson(view), view);
      final source = (view['sourceDocument'] ?? view['document'])! as Map<String, Object?>;
      final stops = data.view.document.stops;
      final route = data.view.document.route!.geometry;
      // A venue beside the middle of the route, 60 m off the line.
      final middle = route[route.length ~/ 2];
      final place = FoodPlace(id: 'osm:node:1', kind: FoodKind.cafe, name: 'Кафе у дома', lat: middle.lat + 0.0002, lon: middle.lon + 0.0005);
      final leg = foodStopLeg(data.view.sourceDocument ?? data.view.document, place.location);
      final result = viewWithDocument(data, insertFoodStop(source, place, leg, null, 'cafe-1'), 5, 'local:en:5');
      expect(result.view.requestedLocale, ContentLocale.en);
      expect(result.view.sourceDocument, isNull);
      expect(result.json['documentLocalization'], {'requestedLocale': 'en', 'contentLocale': 'ru', 'fallbackReason': 'stale'});
      expect(result.view.chapters.length, stops.length + 1);
      expect(result.view.chapters.firstWhere((chapter) => chapter.id == 'cafe-1').localization?.contentLocale, ContentLocale.en);
    });
  });
}
