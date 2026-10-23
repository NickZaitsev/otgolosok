import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/places/place_story.dart';

import '../auth/harness.dart';

Map<String, Object?> _fixture(String name) => jsonDecode(File('test/fixtures/api/$name').readAsStringSync()) as Map<String, Object?>;

List<Map<String, Object?>> _cases(Map<String, Object?> fixture, String key) => (fixture[key]! as List<Object?>).cast<Map<String, Object?>>();

void main() {
  final fixture = _fixture('place_story.json');
  final stories = _cases(fixture, 'stories');
  Map<String, Object?> storyInput(String name) => stories.firstWhere((item) => item['name'] == name)['input']! as Map<String, Object?>;

  group('photos agree with the site parser', () {
    for (final item in _cases(fixture, 'photos')) {
      test('${item['name']}', () => expect(parsePlacePhoto(item['input'])?.toJson(), item['result']));
    }
  });

  group('stories agree with the site parser', () {
    for (final item in stories) {
      test('${item['name']}', () {
        final locale = AppLocale.parse(item['locale']! as String)!;
        if (item['valid'] == true) {
          expect(parsePlaceStory(item['input'], locale).toJson(), item['result']);
        } else {
          expect(() => parsePlaceStory(item['input'], locale), throwsFormatException);
        }
      });
    }
  });

  group('PlaceStoryRepository', () {
    late Harness harness;
    late PlaceStoryRepository repository;
    const path = '/api/content/places/osm:way:1';

    setUp(() {
      harness = Harness();
      repository = PlaceStoryRepository(harness.api, cacheLimit: 2);
    });

    test('a story loaded once is served from the session cache', () async {
      harness.server.on('GET $path', Reply(200, storyInput('valid russian')));
      final first = await repository.load('osm:way:1', AppLocale.ru);
      final second = await repository.load('osm:way:1', AppLocale.ru);
      expect(second, same(first));
      expect(repository.cached('osm:way:1', AppLocale.ru), same(first));
      expect(harness.server.to('GET $path'), hasLength(1));
      expect(harness.server.sent.single.query, isEmpty);
    });

    test('concurrent loads of one story share a request', () async {
      harness.server.on('GET $path', Reply(200, storyInput('valid russian')));
      final results = await Future.wait([repository.load('osm:way:1', AppLocale.ru), repository.load('osm:way:1', AppLocale.ru)]);
      expect(results.first, same(results.last));
      expect(harness.server.to('GET $path'), hasLength(1));
    });

    test('another language is a separate request with lang', () async {
      harness.server.on('GET $path', Reply(200, storyInput('legacy response for english')));
      final story = await repository.load('osm:way:1', AppLocale.en);
      expect(story!.actualLocale, AppLocale.ru);
      expect(harness.server.sent.single.query, {'lang': 'en'});
      expect(repository.cached('osm:way:1', AppLocale.ru), isNull);
    });

    test('an unpublished story is null and is asked again next time', () async {
      harness.server.on('GET $path', const Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'Нет'}}));
      expect(await repository.load('osm:way:1', AppLocale.ru), isNull);
      expect(await repository.load('osm:way:1', AppLocale.ru), isNull);
      expect(harness.server.to('GET $path'), hasLength(2));
    });

    test('a server error is thrown and nothing is cached', () async {
      harness.server.on('GET $path', const Reply(500, {'error': {'code': 'INTERNAL', 'message': 'Сбой'}}));
      await expectLater(repository.load('osm:way:1', AppLocale.ru), throwsA(isA<ApiError>()));
      expect(repository.cached('osm:way:1', AppLocale.ru), isNull);
    });

    test('a malformed answer is a corrupt response, not a missing story', () async {
      harness.server.on('GET $path', const Reply(200, {'place': <String, Object?>{}}));
      await expectLater(repository.load('osm:way:1', AppLocale.ru), throwsA(isA<ApiError>().having((error) => error.code, 'code', 'CORRUPT')));
    });

    test('the least recently used story leaves a full cache', () async {
      for (final id in ['osm:way:1', 'osm:way:2', 'osm:way:3']) {
        harness.server.on('GET /api/content/places/$id', Reply(200, storyInput('valid russian')));
      }
      await repository.load('osm:way:1', AppLocale.ru);
      await repository.load('osm:way:2', AppLocale.ru);
      await repository.load('osm:way:1', AppLocale.ru); // touched: way:2 is now the oldest
      await repository.load('osm:way:3', AppLocale.ru);
      expect(repository.cached('osm:way:1', AppLocale.ru), isNotNull);
      expect(repository.cached('osm:way:2', AppLocale.ru), isNull);
      expect(repository.cached('osm:way:3', AppLocale.ru), isNotNull);
    });
  });
}
