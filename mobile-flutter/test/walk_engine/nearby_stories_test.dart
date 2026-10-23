import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/collation.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/nearby_stories.dart';

import 'fixture_loader.dart';

GeoPoint point(Object? json) => GeoPoint(number(asMap(json)['lat']), number(asMap(json)['lon']));

void main() {
  final fixture = loadFixture('engine/nearby_stories.json');
  // The app's dictionary, generated from the site (src/lib/i18n/mobile-export.test.ts).
  final dictionary = jsonDecode(File('assets/i18n/translations.json').readAsStringSync()) as Map<String, Object?>;
  Translate translator(String locale) => (source, values) {
    final pair = dictionary[source];
    final text = locale == 'ru' || pair == null ? source : asList(pair)[locale == 'en' ? 0 : 1]! as String;
    return fillPlaceholders(text, values);
  };

  final catalog = [
    for (final item in asList(fixture['catalog']))
      NearbyStory(
        id: asMap(item)['id']! as String,
        title: asMap(item)['title']! as String,
        address: asMap(item)['address']! as String,
        location: point(asMap(item)['location']),
        durationSec: number(asMap(item)['durationSec']),
        sourceCount: asMap(item)['sourceCount']! as int,
        factCount: asMap(item)['factCount']! as int,
      ),
  ];

  test('nearbyRadiusForAccuracy', () {
    for (final item in asList(fixture['radii'])) {
      final row = asMap(item);
      expect(nearbyRadiusForAccuracy(number(row['accuracyM'])), row['radius'], reason: '${row['accuracyM']}');
    }
  });

  test('recommendNearbyStories ranks, cuts to three and explains like the site', () {
    final center = point(fixture['center']);
    for (final item in asList(fixture['recommendations'])) {
      final row = asMap(item);
      final locale = row['locale']! as String;
      final result = recommendNearbyStories(center, row['radius']! as int, catalog, translate: translator(locale));
      final expected = asList(row['result']).map(asMap).toList();
      final label = '$locale ${row['radius']}';
      expect([for (final item in result) item.story.id], [for (final item in expected) item['id']], reason: label);
      expect([for (final item in result) item.reason], [for (final item in expected) item['reason']], reason: label);
      expect([for (final item in result) item.distanceM], [for (final item in expected) number(item['distanceM'])], reason: label);
    }
  });

  test('Russian collation: Cyrillic before Latin, ё with е, lower case first', () {
    final titles = ['e', 'Ёлка', 'Арбат', 'ель', 'Ель', 'елка', 'Bolshoy', 'арбат', '10 домов', 'Яуза'];
    titles.sort(compareRussian);
    expect(titles, ['10 домов', 'арбат', 'Арбат', 'елка', 'Ёлка', 'ель', 'Ель', 'Яуза', 'Bolshoy', 'e']);
  });
}
