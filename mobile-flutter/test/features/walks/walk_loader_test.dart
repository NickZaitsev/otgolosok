import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/offline/offline_packs.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/features/walks/walk_loader.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'support.dart';

class _LocalStore implements LocalWalkStore {
  final walks = <String, LocalWalk>{};

  @override
  Future<LocalWalk?> get(String id) async => walks[id];

  @override
  Future<List<LocalWalk>> list() async => walks.values.toList();

  @override
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision}) async =>
      walks[document.id] = LocalWalk(document: document, revision: (expectedRevision ?? -1) + 1);
}

const _shareToken = '11111111-1111-4111-8111-111111111111';
const _localId = '22222222-2222-4222-8222-222222222222';
const _audio = [1, 2, 3, 4];

void main() {
  late Directory root;
  late OfflinePackManager packs;
  late _LocalStore store;
  late FakeAdapter adapter;

  setUp(() {
    root = Directory.systemTemp.createTempSync('walk-loader-');
    packs = OfflinePackManager(root: () async => root, download: (url, target, max) async {
      await target.writeAsBytes(_audio);
      return _audio.length;
    });
    store = _LocalStore();
  });
  tearDown(() => root.deleteSync(recursive: true));

  WalkLoader loader(Object Function(RequestOptions request) handler, {String locale = 'ru'}) {
    adapter = FakeAdapter(handler);
    return WalkLoader(api: fakeApi(adapter, locale: locale), packs: packs, localStore: () => store);
  }

  test('a catalogue walk is read in the requested language', () async {
    final walk = await loader((_) => Reply(200, sampleEnglishView()), locale: 'en')
        .load(const CatalogWalkLink('arbat-test'), locale: ContentLocale.en, userId: null);
    expect(walk.view.locale, ContentLocale.en);
    expect(walk.offline, isFalse);
    expect(walk.offlineRef, const OfflineWalkRef(scope: 'public:catalog', walkId: 'arbat-test', requestedLocale: ContentLocale.en));
    expect(adapter.requests.single.uri.path, '/api/story-walks/arbat-test/view');
    expect(adapter.requests.single.uri.queryParameters, {'lang': 'en'});
  });

  test('a view in another language than requested is rejected', () async {
    await expectLater(
      loader((_) => Reply(200, sampleView()), locale: 'en').load(const CatalogWalkLink('arbat-test'), locale: ContentLocale.en, userId: null),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', 'CORRUPT')),
    );
  });

  test('a moved catalogue walk reports its share token', () async {
    await expectLater(
      loader((_) => Reply(410, {'error': {'code': 'WALK_MOVED', 'message': 'Прогулка переехала.', 'share': _shareToken}}))
          .load(const CatalogWalkLink('arbat-test'), locale: ContentLocale.ru, userId: null),
      throwsA(isA<ApiError>().having((e) => e.movedToShare, 'movedToShare', _shareToken)),
    );
  });

  group('offline copy', () {
    const ref = OfflineWalkRef(scope: 'public:shared', walkId: _shareToken);
    setUp(() async => packs.save(sampleView(audio: _audio), ref));

    final table = <String, (Object, bool)>{
      'stands in when the network is down': (DioExceptionType.connectionError, true),
      'stands in when the server fails': (const Reply(503, {'error': {'message': 'Сервис недоступен.'}}), true),
      'stands in when the server limits requests': (const Reply(429, {'error': {'message': 'Слишком много запросов.'}}), true),
      'never replaces «not found»': (const Reply(404, {'error': {'message': 'Прогулка не найдена.'}}), false),
      'never replaces «no access»': (const Reply(403, {'error': {'message': 'Нет доступа.'}}), false),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () async {
        final load = loader((_) => value.$1).load(const SharedWalkLink(_shareToken), locale: ContentLocale.ru, userId: null);
        if (value.$2) {
          final walk = await load;
          expect(walk.offline, isTrue);
          expect(walk.savedAt, isNotNull);
          expect(walk.view.revision, 2);
        } else {
          await expectLater(load, throwsA(isA<ApiError>()));
        }
      });
    }

    test('without a copy the failure is reported', () async {
      await expectLater(
        loader((_) => DioExceptionType.connectionError).load(const CatalogWalkLink('arbat-test'), locale: ContentLocale.ru, userId: null),
        throwsA(isA<ApiError>().having((e) => e.isNetwork, 'network', isTrue)),
      );
    });
  });

  test('account walks keep copies under their user only', () async {
    const id = '33333333-3333-4333-8333-333333333333';
    await packs.save(sampleView(audio: _audio), const OfflineWalkRef(scope: 'user-1', walkId: id));
    final api = loader((_) => DioExceptionType.connectionError);
    expect((await api.load(const AccountWalkLink(id), locale: ContentLocale.ru, userId: 'user-1')).offline, isTrue);
    await expectLater(api.load(const AccountWalkLink(id), locale: ContentLocale.ru, userId: null), throwsA(isA<ApiError>()));
    expect(adapter.requests.last.uri.path, '/api/me/walks/$id/view');
  });

  group('local walks', () {
    Map<String, Object?> document({bool story = false}) {
      final json = jsonDecode(jsonEncode(sampleView()['document'])) as Map<String, Object?>;
      json['id'] = _localId;
      if (story) ((json['stops']! as List<Object?>).first! as Map<String, Object?>)['storyRef'] = {'kind': 'catalog', 'id': 'arbat-10'};
      return json;
    }

    Future<void> keep(Map<String, Object?> json, int revision) async =>
        store.walks[_localId] = LocalWalk(document: WalkDocument.fromJson(json), revision: revision);

    test('a missing walk is «not found»', () async {
      await expectLater(
        loader((_) => throw StateError('no request expected')).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null),
        throwsA(isA<ApiError>().having((e) => e.message, 'message', 'Локальная прогулка не найдена.')),
      );
    });

    test('a walk without stories opens without a request', () async {
      await keep(document(), 0);
      final walk = await loader((_) => throw StateError('no request expected')).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null);
      expect(walk.view.contentVersion, 'local:0');
      expect(walk.view.chapters.map((chapter) => chapter.status), everyElement(ChapterStatus.notRequested));
    });

    test('published stories of its stops are filled in by the server', () async {
      final json = document(story: true);
      await keep(json, 1);
      final answer = sampleView(revision: 1);
      answer['document'] = json;
      final walk = await loader((_) => Reply(200, answer)).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null);
      final request = adapter.requests.single;
      expect(request.uri.path, '/api/story-walks/resolve');
      expect((jsonDecode(request.data as String) as Map<String, Object?>)['revision'], 1);
      expect(walk.view.contentVersion, 'local:1:v2');
      expect(walk.view.chapters.first.status, ChapterStatus.ready);
    });

    test('offline it opens the copy of the same revision, otherwise without stories', () async {
      final json = document(story: true);
      final saved = sampleView(audio: _audio, revision: 1);
      saved['document'] = json;
      await packs.save(saved, const OfflineWalkRef(scope: 'device:local', walkId: _localId));

      await keep(json, 1);
      final same = await loader((_) => DioExceptionType.connectionError).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null);
      expect(same.offline, isTrue);

      await keep(json, 2);
      final edited = await loader((_) => DioExceptionType.connectionError).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null);
      expect(edited.offline, isFalse);
      expect(edited.view.revision, 2);
      expect(edited.view.chapters.first.status, ChapterStatus.preparing);
    });

    test('an answer for another revision is not trusted', () async {
      final json = document(story: true);
      await keep(json, 1);
      final answer = sampleView(revision: 7);
      answer['document'] = json;
      final walk = await loader((_) => Reply(200, answer)).load(const LocalWalkLink(_localId), locale: ContentLocale.ru, userId: null);
      expect(walk.view.contentVersion, 'local:1');
    });
  });
}
