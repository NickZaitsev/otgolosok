import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/player/checkpoint_store.dart';
import 'package:otgolosok/features/walks/add_food_stop.dart';
import 'package:otgolosok/features/walks/food_stop.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/features/walks/walk_loader.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';
import 'package:shared_preferences/shared_preferences.dart';

GeoPoint at(int i) => GeoPoint(55.75 + i * 0.001, 37.6);
const _id = '33333333-3333-4333-8333-333333333333';
const _copy = '44444444-4444-4444-8444-444444444444';
const _server = '55555555-5555-4555-8555-555555555555';
final _place = FoodPlace(id: 'osm:node:7', kind: FoodKind.coffee, name: 'Кофейня', lat: at(4).lat + 0.0002, lon: 37.601);

Map<String, Object?> _stop(String id, int i) =>
    {'id': id, 'place': {'address': id, 'location': at(i).toJson()}, 'storyRef': null, 'transition': '', 'nextHint': ''};

Map<String, Object?> _document([String id = _id]) => {
      'version': 2, 'id': id, 'title': 'Прогулка', 'description': '', 'city': 'Москва', 'mode': 'open', 'minutes': 30,
      'start': {'address': 'Старт', 'location': at(0).toJson()},
      'destination': {'address': 'Финиш', 'location': at(10).toJson()},
      'stops': [_stop('a', 3), _stop('b', 6)],
      'route': {'geometry': [for (var i = 0; i <= 10; i++) at(i).toJson()], 'distanceM': 1100, 'walkingMinutes': 14, 'attribution': '© OSM'},
      'fieldChecked': false,
    };

Map<String, Object?> _viewJson(Map<String, Object?> document, [int revision = 0]) => {
      'document': document,
      'revision': revision,
      'contentVersion': 'v',
      'chapters': [
        for (final id in ['a', 'b']) {'id': id, 'status': 'not_requested', 'story': null, 'audio': null},
      ],
    };

WalkViewData _view({int revision = 0, String id = _id}) {
  final json = _viewJson(_document(id), revision);
  return WalkViewData(WalkView.fromJson(json), json);
}

Map<String, Object?> _plan() => {
      'stops': [
        {'address': 'Кофейня', 'location': _place.location.toJson()},
      ],
      'geometry': [at(3).toJson(), _place.location.toJson(), at(6).toJson()],
      'distanceM': 400,
      'walkingMinutes': 5,
      'attribution': '© OSM',
    };

/// The same value moved to the Kazan Kremlin: every point keeps its offset.
Object? _kazan(Object? value) => switch (value) {
      Map<String, Object?>() => {
          for (final MapEntry(:key, value: item) in value.entries)
            key: switch ((key, item)) {
              ('lat', final num lat) => lat + 0.045,
              ('lon', final num lon) => lon + 11.505,
              ('city', _) => 'Казань',
              _ => _kazan(item),
            },
        },
      List<Object?>() => [for (final item in value) _kazan(item)],
      _ => value,
    };

/// Device walks with the revision check of the builder's store.
class _Store implements LocalWalkStore {
  final walks = <String, LocalWalk>{};

  @override
  Future<LocalWalk?> get(String id) async => walks[id];

  @override
  Future<List<LocalWalk>> list() async => walks.values.toList();

  @override
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision}) async {
    final current = walks[document.id];
    if (current?.revision != expectedRevision) throw StateError('Прогулка изменена в другом окне.');
    return walks[document.id] = LocalWalk(document: document, revision: current == null ? 0 : current.revision + 1);
  }
}

class _Harness {
  _Harness(this.settings);

  final SettingsStore settings;
  final store = _Store();
  final planned = <Map<String, Object?>>[];
  final patched = <(String, String, Map<String, Object?>, int)>[];
  final created = <(String, Map<String, Object?>, String)>[];
  Future<Object?> Function() plan = () async => _plan();
  Future<SavedAccountWalk> Function() patch = () async => (id: _id, revision: 8);
  Future<SavedAccountWalk> Function() create = () async => (id: _server, revision: 0);
  Future<String?> Function() user = () async => null;

  static Future<_Harness> open([Map<String, Object> prefs = const {}]) async {
    SharedPreferences.setMockInitialValues(prefs);
    return _Harness(SettingsStore(await SharedPreferences.getInstance()));
  }

  FoodStopDeps get deps => FoodStopDeps(
        plan: (body) {
          planned.add(body);
          return plan();
        },
        updateAccountWalk: (id, title, snapshot, revision) {
          patched.add((id, title, snapshot, revision));
          return patch();
        },
        createAccountWalk: (title, snapshot, key) {
          created.add((title, snapshot, key));
          return create();
        },
        signedInUserId: () => user(),
        localStore: store,
        settings: settings,
        checkpoints: SettingsCheckpointStore(settings),
        newId: () => _copy,
      );

  Future<FoodStopResult> run(WalkLink link, [WalkViewData? view, FoodPlace? place]) => addFoodStop(view ?? _view(), link, place ?? _place, deps);
}

List<String> _stopIds(WalkDocument document) => [for (final stop in document.stops) stop.id];
String _encode(WalkDocument document) => jsonEncode(document.toJson());

void main() {
  test('своя прогулка на устройстве меняется на месте с новой ревизией', () async {
    final h = await _Harness.open();
    await h.store.save(WalkDocument.fromJson(_document()));
    final result = await h.run(const LocalWalkLink(_id));
    expect(result.moved, isNull);
    expect((result.data.view.revision, result.data.view.contentVersion), (1, 'local:1'));
    expect(_stopIds(result.data.view.document), ['a', _copy, 'b']);
    expect(_encode(h.store.walks[_id]!.document), _encode(result.data.view.document));
    expect(h.planned.single['start'], {'address': 'Точка маршрута', 'location': at(3).toJson()});
  });

  test('прогулка устройства, изменённая в другом окне, не перезаписывается', () async {
    final h = await _Harness.open();
    await h.store.save(WalkDocument.fromJson(_document()));
    await h.store.save(WalkDocument.fromJson(_document()), expectedRevision: 0);
    await expectLater(h.run(const LocalWalkLink(_id)), throwsA(isA<StateError>()));
    expect(_stopIds(h.store.walks[_id]!.document), ['a', 'b']);
  });

  test('прогулка из кабинета сохраняется с прежней ревизией для защиты от гонок', () async {
    final h = await _Harness.open();
    final result = await h.run(const AccountWalkLink(_id), _view(revision: 7));
    final (id, title, snapshot, revision) = h.patched.single;
    expect((id, title, revision, snapshot['id']), (_id, 'Прогулка', 7, _id));
    expect([for (final stop in snapshot['stops']! as List<Object?>) (stop! as Map<String, Object?>)['id']], ['a', _copy, 'b']);
    expect((result.moved, result.data.view.revision, result.data.view.contentVersion), (null, 8, 'account:8'));
    expect(h.created, isEmpty);
  });

  test('чужая прогулка без входа копируется на устройство вместе с направлением и местом в истории', () async {
    final checkpoint = {'version': 1, 'routeId': 'catalog-walk', 'chapterId': 'a', 'audioUrl': '/audio/walk/a.mp3', 'positionSec': 12};
    final h = await _Harness.open({
      'walk.direction.catalog-walk': 'reverse',
      'otgolosok:playback:catalog-walk:reverse': jsonEncode(checkpoint),
    });
    final result = await h.run(const CatalogWalkLink('catalog-walk'), _view(id: 'catalog-walk'));
    expect(result.moved, isA<LocalWalkLink>().having((link) => link.id, 'id', _copy));
    expect(result.data.view.document.id, _copy);
    expect(h.store.walks[_copy]!.document.stops, hasLength(3));
    expect(h.settings.reversed(_copy), isTrue);
    expect(jsonDecode(h.settings.readString('otgolosok:playback:$_copy:reverse')!), {...checkpoint, 'routeId': _copy});
    expect(h.settings.readString('otgolosok:playback:$_copy'), isNull);
    expect(h.patched, isEmpty);
    expect(h.created, isEmpty);
  });

  test('чужой контрольной точке и повреждённой записи прогресса копия не наследует', () async {
    final h = await _Harness.open({
      'otgolosok:playback:catalog-walk': jsonEncode({'version': 1, 'routeId': 'other-walk', 'chapterId': 'a', 'audioUrl': '/a.mp3', 'positionSec': 3}),
      'otgolosok:playback:catalog-walk:reverse': '{broken',
    });
    final result = await h.run(const CatalogWalkLink('catalog-walk'), _view(id: 'catalog-walk'));
    expect(result.moved, isA<LocalWalkLink>());
    expect(h.settings.readString('otgolosok:playback:$_copy'), isNull);
    expect(h.settings.readString('otgolosok:playback:$_copy:reverse'), isNull);
    expect(h.settings.reversed(_copy), isFalse);
  });

  test('переносит прогресс только выбранного языка в локализованную копию', () async {
    final checkpoint = {'version': 1, 'routeId': 'catalog-walk', 'chapterId': 'a', 'audioUrl': '/audio/walk/a-en.mp3', 'positionSec': 12};
    final h = await _Harness.open({
      'otgolosok:playback:catalog-walk:en': jsonEncode(checkpoint),
      'otgolosok:playback:catalog-walk': jsonEncode({...checkpoint, 'audioUrl': '/audio/walk/a-ru.mp3'}),
    });
    final source = _document('catalog-walk')..['description'] = 'Русское описание';
    (source['stops']! as List<Object?>)[0] = {..._stop('a', 3), 'transition': 'Идите прямо.'};
    final display = {...source, 'title': 'A walk', 'description': 'English description'};
    display['stops'] = [
      {..._stop('a', 3), 'transition': 'Continue straight.'},
      _stop('b', 6),
    ];
    const localization = {'requestedLocale': 'en', 'contentLocale': 'en', 'fallbackReason': null};
    final json = <String, Object?>{
      ..._viewJson(display),
      'sourceDocument': source,
      'requestedLocale': 'en',
      'documentLocalization': localization,
      'chapters': [
        for (final id in ['a', 'b']) {'id': id, 'status': 'not_requested', 'story': null, 'audio': null, 'localization': localization},
      ],
    };
    final result = await h.run(const CatalogWalkLink('catalog-walk'), WalkViewData(WalkView.fromJson(json), json));
    final view = result.data.view;
    expect(view.requestedLocale, ContentLocale.en);
    expect(view.contentVersion, 'local:en:0');
    expect(jsonDecode(h.settings.readString('otgolosok:playback:$_copy:en')!), {...checkpoint, 'routeId': _copy});
    expect(h.settings.readString('otgolosok:playback:$_copy'), isNull);
    expect(view.chapters.firstWhere((chapter) => chapter.id == _copy).localization?.contentLocale, ContentLocale.en);
    expect((view.document.title, view.document.description), ('Прогулка', 'Русское описание'));
    expect(view.sourceDocument, isNull);
    expect(result.data.json['documentLocalization'], {'requestedLocale': 'en', 'contentLocale': 'ru', 'fallbackReason': 'stale'});
    expect(h.store.walks[_copy]!.document.title, 'Прогулка');
  });

  test('чужая прогулка при входе копируется в кабинет под ID, который выдал сервер', () async {
    final h = await _Harness.open({'walk.direction.$_id': 'reverse'});
    h.user = () async => 'user';
    final result = await h.run(const SharedWalkLink('token'), _view());
    final (title, snapshot, key) = h.created.single;
    expect((title, key, snapshot['id']), ('Прогулка', 'walk-$_copy', _copy));
    expect(result.moved, isA<AccountWalkLink>().having((link) => link.id, 'id', _server));
    expect((result.data.view.document.id, result.data.view.contentVersion), (_server, 'account:0'));
    expect(h.settings.reversed(_server), isTrue);
    expect(h.store.walks, isEmpty);
  });

  test('если не удалось узнать, кто вошёл, копия остаётся на устройстве', () async {
    final h = await _Harness.open();
    h.user = () async => throw const ApiError.network();
    final result = await h.run(const CatalogWalkLink('catalog-walk'), _view(id: 'catalog-walk'));
    expect(result.moved, isA<LocalWalkLink>());
    expect(h.created, isEmpty);
  });

  for (final status in [400, 404]) {
    test('отказ маршрутизатора $status говорит о пути к заведению', () async {
      final h = await _Harness.open();
      h.plan = () async => throw ApiError(message: 'Отсюда не получилось проложить пешеходную прогулку.', status: status);
      await expectLater(
        h.run(const LocalWalkLink(_id)),
        throwsA(isA<FoodStopError>().having((error) => error.message, 'message', 'Не получилось проложить пешеходный путь к этому заведению.')),
      );
    });
  }

  test('недоступный маршрутизатор передаёт своё сообщение и ничего не сохраняет', () async {
    final h = await _Harness.open();
    await h.store.save(WalkDocument.fromJson(_document()));
    h.plan = () async => throw const ApiError(message: 'Пешеходный маршрутизатор временно недоступен.', status: 503, retryable: true);
    await expectLater(h.run(const LocalWalkLink(_id)), throwsA(isA<ApiError>().having((error) => error.message, 'message', 'Пешеходный маршрутизатор временно недоступен.')));
    expect(h.store.walks[_id]!.revision, 0);
  });

  final corrupt = <(String, Map<String, Object?> Function())>[
    ('без остановки', () => _plan()..['stops'] = <Object?>[]),
    ('с двумя остановками', () => _plan()..['stops'] = [...(_plan()['stops']! as List<Object?>), ...(_plan()['stops']! as List<Object?>)]),
    ('без геометрии', () => _plan()..remove('geometry')),
  ];
  for (final (name, plan) in corrupt) {
    test('повреждённый ответ маршрутизатора отклоняется: $name', () async {
      final h = await _Harness.open();
      await h.store.save(WalkDocument.fromJson(_document()));
      h.plan = () async => plan();
      await expectLater(
        h.run(const LocalWalkLink(_id)),
        throwsA(isA<ApiError>().having((error) => error.message, 'message', 'Сервис вернул некорректный маршрут. Попробуйте ещё раз.')),
      );
      expect(h.store.walks[_id]!.revision, 0);
    });
  }

  group('в казанской прогулке', () {
    final kazanDocument = _kazan(_document())! as Map<String, Object?>;
    final kazanPlace = FoodPlace(id: 'osm:node:7', kind: FoodKind.coffee, name: 'Кофейня', lat: _place.lat + 0.045, lon: _place.lon + 11.505);
    WalkViewData kazanView() {
      final json = _viewJson(kazanDocument);
      return WalkViewData(WalkView.fromJson(json), json);
    }

    test('принимает путь к заведению внутри Казани', () async {
      final h = await _Harness.open();
      h.plan = () async => _kazan(_plan());
      await h.store.save(WalkDocument.fromJson(kazanDocument));
      final result = await h.run(const LocalWalkLink(_id), kazanView(), kazanPlace);
      expect(_stopIds(result.data.view.document), ['a', _copy, 'b']);
      expect(result.data.view.document.city, 'Казань');
    });

    test('отклоняет путь, уходящий в другой город', () async {
      final h = await _Harness.open();
      final plan = _kazan(_plan())! as Map<String, Object?>;
      h.plan = () async => {...plan, 'geometry': [...plan['geometry']! as List<Object?>, at(5).toJson()]};
      await h.store.save(WalkDocument.fromJson(kazanDocument));
      await expectLater(h.run(const LocalWalkLink(_id), kazanView(), kazanPlace), throwsA(isA<ApiError>()));
    });
  });

  test('заведению у самой остановки маршрутизатор не нужен', () async {
    final h = await _Harness.open();
    await h.store.save(WalkDocument.fromJson(_document()));
    // Two metres past stop «a», on the line: closer than 5 m to an end of its leg.
    final kiosk = FoodPlace(id: 'osm:node:9', kind: FoodKind.coffee, name: 'Киоск у метро', lat: at(3).lat + 0.00002, lon: 37.6);
    final result = await h.run(const LocalWalkLink(_id), null, kiosk);
    expect(h.planned, isEmpty);
    expect(_stopIds(result.data.view.document), ['a', _copy, 'b']);
  });

  test('ошибка кабинета не подменяется успехом', () async {
    final h = await _Harness.open();
    h.patch = () async => throw const ApiError(message: 'Прогулка изменена в другой вкладке.', status: 409);
    await expectLater(h.run(const AccountWalkLink(_id)), throwsA(isA<ApiError>().having((error) => error.status, 'status', 409)));
  });
}
