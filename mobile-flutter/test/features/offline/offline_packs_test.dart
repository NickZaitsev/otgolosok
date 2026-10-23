import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/offline/offline_food.dart';
import 'package:otgolosok/features/offline/offline_packs.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import '../walks/support.dart';

/// Serves recordings by URL from [files]; [corrupt] URLs come back with other bytes.
class _Server {
  _Server(this.files);
  final Map<String, List<int>> files;
  final corrupt = <String>{};
  final failures = <String, Object>{};
  final downloads = <String>[];
  Completer<void>? gate;

  Future<int> download(String url, File target, int maxBytes) async {
    downloads.add(url);
    await gate?.future;
    final failure = failures[url];
    if (failure != null) throw failure;
    final bytes = corrupt.contains(url) ? [...files[url]!, 0] : files[url]!;
    await target.writeAsBytes(bytes, flush: true);
    if (bytes.length > maxBytes) throw const ApiError(message: 'Файл больше допустимого размера.', code: 'TOO_LARGE');
    return bytes.length;
  }
}

class _Food implements OfflineFoodSource {
  _Food(this.result);
  OfflineFoodDownload result;
  final seeded = <OfflineFoodBundle>[];

  @override
  Future<OfflineFoodDownload> download(List<GeoPoint> geometry, int maxBytes) async => result;

  @override
  void seed(OfflineFoodBundle bundle) => seeded.add(bundle);
}

void main() {
  late Directory root;
  late _Server server;
  final audio = utf8.encode('mp3 bytes of the first story');
  final other = utf8.encode('another recording');
  String urlOf(List<int> bytes) => '/api/story-audio/${sha256Hex(bytes)}.mp3';

  setUp(() {
    root = Directory.systemTemp.createTempSync('walk-packs-');
    server = _Server({urlOf(audio): audio, urlOf(other): other});
  });
  tearDown(() => root.deleteSync(recursive: true));

  OfflinePackManager manager({int maxBytes = maxPackBytes, OfflineFoodSource? food}) => OfflinePackManager(
        root: () async => root,
        download: server.download,
        food: food,
        now: () => DateTime.utc(2026, 10, 1, 12),
        maxBytes: maxBytes,
      );

  const catalog = OfflineWalkRef(scope: 'public:catalog', walkId: 'arbat-test');
  List<String> files() => [
        for (final entity in root.listSync(recursive: true))
          if (entity is File) entity.path.substring(root.path.length + 1).replaceAll(r'\', '/'),
      ]..sort();
  Set<String> stages() => {for (final file in files()) if (RegExp(r'^.*/staging-[0-9a-f]+').firstMatch(file) case final match?) match[0]!};

  group('offlineWalkRef', () {
    final table = <String, (OfflineWalkKind, String, String?, ContentLocale, OfflineWalkRef?)>{
      'account walk under its user': (OfflineWalkKind.id, 'w', 'user-1', ContentLocale.ru, const OfflineWalkRef(scope: 'user-1', walkId: 'w')),
      'account walk of a guest has no copy': (OfflineWalkKind.id, 'w', null, ContentLocale.ru, null),
      'catalogue walk is public': (OfflineWalkKind.catalog, 'arbat', 'user-1', ContentLocale.ru, const OfflineWalkRef(scope: 'public:catalog', walkId: 'arbat')),
      'shared walk is public': (OfflineWalkKind.share, 't', null, ContentLocale.en,
          const OfflineWalkRef(scope: 'public:shared', walkId: 't', requestedLocale: ContentLocale.en)),
      'local walk stays on the device': (OfflineWalkKind.local, 'l', null, ContentLocale.ru, const OfflineWalkRef(scope: 'device:local', walkId: 'l')),
      'empty key': (OfflineWalkKind.catalog, '', null, ContentLocale.ru, null),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () => expect(offlineWalkRef(value.$1, value.$2, value.$3, value.$4), value.$5));
    }
  });

  test('a saved copy opens with its verified recordings', () async {
    final packs = manager();
    final result = await packs.save(sampleView(audio: audio), catalog);
    expect(result.availableAudio, 1);
    expect(result.foodWarning, isFalse);
    final copy = await packs.load(catalog);
    expect(copy, isNotNull);
    expect(copy!.view.revision, 2);
    expect(copy.manifest.savedAt, '2026-10-01T12:00:00.000Z');
    expect(copy.manifest.audio.single.bytes, audio.length);
    final local = copy.localAudio[urlOf(audio)]!;
    expect(File.fromUri(local).readAsBytesSync(), audio);
    expect(await packs.localRecordings(copy.view), {urlOf(audio): local});
    // Another language is another copy.
    expect(await packs.load(const OfflineWalkRef(scope: 'public:catalog', walkId: 'arbat-test', requestedLocale: ContentLocale.en)), isNull);
  });

  test('a recording with a wrong checksum fails the save and keeps the previous copy', () async {
    final packs = manager();
    await packs.save(sampleView(audio: audio), catalog);
    server.corrupt.add(urlOf(other));
    await expectLater(
      packs.save(sampleView(audio: other, revision: 3), catalog),
      throwsA(isA<OfflinePackError>().having((e) => e.message, 'message', 'Запись загрузилась с неверной контрольной суммой.')),
    );
    final copy = await packs.load(catalog);
    expect(copy!.view.revision, 2);
    expect(stages(), hasLength(1), reason: 'the failed stage is gone, the published one stays');
    expect(files().where((file) => file.startsWith('audio/')), ['audio/${sha256Hex(audio)}.mp3']);
  });

  test('a copy over the budget is not saved', () async {
    final packs = manager(maxBytes: audio.length - 1);
    await expectLater(packs.save(sampleView(audio: audio), catalog), throwsA(same(OfflinePackError.tooLarge)));
    expect(await packs.load(catalog), isNull);
    expect(files(), isEmpty);
  });

  test('a refused download explains itself; a lost connection keeps its own message', () async {
    final packs = manager();
    server.failures[urlOf(audio)] = const ApiError(message: 'Не найдено', status: 404);
    await expectLater(packs.save(sampleView(audio: audio), catalog),
        throwsA(isA<OfflinePackError>().having((e) => e.message, 'message', 'Не удалось скачать запись для офлайн-прогулки.')));
    server.failures[urlOf(audio)] = const ApiError.network();
    await expectLater(packs.save(sampleView(audio: audio), catalog), throwsA(isA<ApiError>().having((e) => e.isNetwork, 'network', isTrue)));
    expect(files(), isEmpty);
  });

  test('a new revision replaces the copy, reuses saved recordings and drops unused ones', () async {
    final packs = manager();
    await packs.save(sampleView(audio: audio), catalog);
    await packs.save(sampleView(audio: audio, revision: 3, contentVersion: 'v3'), catalog);
    expect(server.downloads, [urlOf(audio)], reason: 'the verified recording is not downloaded again');
    expect((await packs.load(catalog))!.manifest.contentVersion, 'v3');
    await packs.save(sampleView(audio: other, revision: 4), catalog);
    expect((await packs.load(catalog))!.view.revision, 4);
    expect(files().where((file) => file.startsWith('audio/')), ['audio/${sha256Hex(other)}.mp3']);
    expect(stages(), hasLength(1));
  });

  test('a save interrupted by a killed app is cleaned up and never published', () async {
    final packs = manager();
    await packs.save(sampleView(audio: audio), catalog);
    final published = files().toSet();
    final orphan = Directory('${root.path}/packs/public%3Acatalog/arbat-test/staging-${'0' * 32}')..createSync(recursive: true);
    File('${orphan.path}/pending.json').writeAsStringSync(jsonEncode({'audio': [sha256Hex(other)]}));
    File('${orphan.path}/download.tmp').writeAsBytesSync(other.take(3).toList());
    File('${root.path}/audio/${sha256Hex(other)}.mp3').writeAsBytesSync(other);

    await manager().cleanUp();
    expect(files().toSet(), published);
    expect((await packs.load(catalog))!.view.revision, 2);
  });

  test('sign-out removes the account copies and the recordings only they used', () async {
    final packs = manager();
    const account = OfflineWalkRef(scope: 'user-1', walkId: '11111111-1111-4111-8111-111111111111');
    await packs.save(sampleView(audio: audio), catalog);
    await packs.save(sampleView(audio: other), account);
    await packs.clearScope('user-1');
    expect(await packs.load(account), isNull);
    expect(await packs.load(catalog), isNotNull);
    expect(files().where((file) => file.startsWith('audio/')), ['audio/${sha256Hex(audio)}.mp3']);
  });

  test('a save still running at sign-out is not published', () async {
    final packs = manager();
    const account = OfflineWalkRef(scope: 'user-1', walkId: 'w');
    server.gate = Completer<void>();
    final saving = packs.save(sampleView(audio: audio), account);
    await Future<void>.delayed(Duration.zero);
    final clearing = packs.clearScope('user-1');
    server.gate!.complete();
    await expectLater(saving, throwsA(isA<OfflinePackError>()));
    await clearing;
    expect(await packs.load(account), isNull);
    expect(files(), isEmpty);
  });

  test('a copy in another language than the walk is refused', () async {
    await expectLater(
      manager().save(sampleEnglishView(), catalog),
      throwsA(isA<OfflinePackError>().having((e) => e.message, 'message', 'Язык офлайн-копии не совпадает с открытой прогулкой.')),
    );
  });

  test('a damaged pointer or view is no copy at all', () async {
    final packs = manager();
    await packs.save(sampleView(audio: audio), catalog);
    final pointer = File('${root.path}/packs/public%3Acatalog/arbat-test/pointer.json');
    final saved = jsonDecode(pointer.readAsStringSync()) as Map<String, Object?>;
    final stage = saved['stage']! as String;

    pointer.writeAsStringSync(jsonEncode({...saved, 'stage': '../../escape/staging-${'0' * 32}'}));
    expect(await packs.load(catalog), isNull);

    pointer.writeAsStringSync(jsonEncode(saved));
    File('${root.path}/$stage/view.json').writeAsStringSync('{"document": {}}');
    expect(await packs.load(catalog), isNull);
  });

  test('removing a copy deletes it with its recordings', () async {
    final packs = manager();
    await packs.save(sampleView(audio: audio), catalog);
    await packs.remove(catalog);
    expect(await packs.load(catalog), isNull);
    expect(files(), isEmpty);
  });

  group('food', () {
    OfflineFoodBundle bundle({int? declared}) => OfflineFoodBundle(
          manifestBody: '{"cells":[]}',
          sourceEditedAt: '2026-09-01T00:00:00Z',
          attribution: '© OpenStreetMap',
          cells: [OfflineFoodCell(key: '1115:752', etag: 'e1', body: '{"places":[]}', bytes: declared ?? 13)],
        );

    test('saved cells are seeded into the store when the walk opens from the copy', () async {
      final food = _Food(OfflineFoodDownload(bundle: bundle(), warning: false));
      final packs = manager(food: food);
      final result = await packs.save(sampleView(audio: audio), catalog);
      expect(result.manifest.food!.cells.single.key, '1115:752');
      await packs.load(catalog);
      expect(food.seeded, isEmpty, reason: 'a status check does not seed');
      await packs.load(catalog, seedFood: true);
      expect(food.seeded.single.cells.single.body, '{"places":[]}');
    });

    test('a damaged food bundle is skipped with a warning, the walk is saved', () async {
      final food = _Food(OfflineFoodDownload(bundle: bundle(declared: 99), warning: false));
      final result = await manager(food: food).save(sampleView(audio: audio), catalog);
      expect(result.foodWarning, isTrue);
      expect(result.manifest.food, isNull);
      expect(result.availableAudio, 1);
    });

    test('a damaged saved cell never prevents opening the walk', () async {
      final food = _Food(OfflineFoodDownload(bundle: bundle(), warning: false));
      final packs = manager(food: food);
      await packs.save(sampleView(audio: audio), catalog);
      final cell = files().firstWhere((file) => file.endsWith('1115_752.json'));
      File('${root.path}/$cell').writeAsStringSync('{"places":[1]}');
      expect(await packs.load(catalog, seedFood: true), isNotNull);
      expect(food.seeded, isEmpty);
    });
  });
}
