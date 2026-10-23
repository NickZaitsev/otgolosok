import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'fixture_loader.dart';

/// A deep copy of decoded JSON, so a test can change a sample freely.
Map<String, Object?> copy(Object? value) =>
    jsonDecode(jsonEncode(value)) as Map<String, Object?>;

void main() {
  final fixture = loadFixture('api/walk_view.json');

  group('validateWalkDocument verdicts of the site', () {
    for (final item in asList(fixture['documents'])) {
      final sample = asMap(item);
      final name = sample['name']! as String;
      test(name, () {
        if (sample['valid'] == true) {
          final document = WalkDocument.fromJson(sample['input']);
          expect(document.toJson(), sample['result'], reason: 'the typed model keeps every field');
        } else {
          expect(() => WalkDocument.fromJson(sample['input']), throwsFormatException);
        }
      });
    }
  });

  group('validateWalkView verdicts of the site', () {
    for (final item in asList(fixture['views'])) {
      final sample = asMap(item);
      final name = sample['name']! as String;
      test(name, () {
        if (sample['valid'] == true) {
          final view = WalkView.fromJson(sample['input']);
          expect(view.toJson(), sample['result']);
        } else {
          expect(() => WalkView.fromJson(sample['input']), throwsFormatException);
        }
      });
    }
  });

  Map<String, Object?> validView(String name) => copy(
    asList(fixture['views']).map(asMap).firstWhere((item) => item['name'] == name)['input'],
  );

  group('beyond the fixture', () {
    test('a document without an id is rejected (the site coerces undefined to "undefined")', () {
      final view = validView('valid');
      asMap(view['document']).remove('id');
      expect(() => WalkView.fromJson(view), throwsFormatException);
    });

    test('a numeric stop id is rejected (the site coerces it to a string)', () {
      final view = validView('valid');
      asMap(asList(asMap(view['document'])['stops'])[0])['id'] = 12;
      expect(() => WalkView.fromJson(view), throwsFormatException);
    });

    test('non-object payloads are rejected', () {
      for (final payload in <Object?>[null, 1, 'walk', <Object?>[], <String, Object?>{}]) {
        expect(() => WalkView.fromJson(payload), throwsFormatException, reason: '$payload');
      }
    });

    test('a translated view may differ from its source only in texts', () {
      final view = validView('valid english fallback');
      final source = copy(view['document']);
      asMap(view['document'])['title'] = 'Arbat';
      asMap(asList(asMap(view['document'])['stops'])[0])['transition'] = 'Walk on.';
      view['sourceDocument'] = source;
      view['documentLocalization'] = {'requestedLocale': 'en', 'contentLocale': 'en', 'fallbackReason': null};
      for (final chapter in asList(view['chapters'])) {
        asMap(chapter)['localization'] = {'requestedLocale': 'en', 'contentLocale': 'en', 'fallbackReason': null};
        final audio = asMap(chapter)['audio'];
        if (audio != null) asMap(audio)['language'] = 'en';
      }
      final parsed = WalkView.fromJson(view);
      expect(parsed.document.title, 'Arbat');
      expect(parsed.sourceDocument!.title, 'Арбат');

      final moved = copy(view);
      asMap(asMap(asList(asMap(moved['document'])['stops'])[0])['place'])['address'] = 'Москва, Арбат, 99';
      expect(() => WalkView.fromJson(moved), throwsFormatException, reason: 'addresses are not texts');

      final same = copy(view);
      same['sourceDocument'] = copy(same['document']);
      expect(() => WalkView.fromJson(same), throwsFormatException, reason: 'a source equal to the document');
    });

    test('a walking document over 100 000 JSON characters is rejected', () {
      final view = validView('valid');
      final stops = asList(asMap(view['document'])['stops']);
      for (final stop in stops) {
        asMap(stop)['transition'] = 'а' * 1200;
        asMap(stop)['nextHint'] = 'б' * 1200;
      }
      expect(WalkView.fromJson(view).document.stops, hasLength(2));
      final document = asMap(view['document']);
      final template = asMap(stops.first);
      List<Object?> stopsOf(int count) => [
        for (var index = 0; index < count; index += 1)
          {...copy(template), 'id': 'stop-x$index'},
      ];
      document['route'] = null;
      document['stops'] = stopsOf(30);
      expect(WalkDocument.fromJson(document).stops, hasLength(30), reason: 'about 75 000 characters');
      document['stops'] = stopsOf(40);
      expect(() => WalkDocument.fromJson(document), throwsFormatException, reason: 'about 100 500 characters');
    });
  });
}
