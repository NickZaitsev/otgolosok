import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/nearby_walks.dart';
import 'package:otgolosok/walk_engine/distance.dart';

import '../auth/harness.dart';

void main() {
  final fixture = jsonDecode(File('test/fixtures/api/walk_cards.json').readAsStringSync()) as Map<String, Object?>;
  final cases = (fixture['nearby']! as List<Object?>).cast<Map<String, Object?>>();

  group('nearby walks agree with the site validator', () {
    for (final item in cases) {
      test('${item['name']}', () {
        if (item['valid'] == true) {
          expect([for (final walk in validateNearbyWalks(item['input'])) walk.toJson()], item['result']);
        } else {
          expect(() => validateNearbyWalks(item['input']), throwsFormatException);
        }
      });
    }
  });

  test('a nearby walk opens at its entry stop', () {
    final valid = cases.firstWhere((item) => item['name'] == 'valid');
    final walk = validateNearbyWalks(valid['input']).single;
    expect(walk.location, '/walk?catalog=arbat&fromStop=stop-2');
    expect(walk.isOwn, isFalse);
  });

  test('the request sends the point with six decimals', () async {
    final harness = Harness();
    harness.server.on('GET $nearbyWalksPath', const Reply(200, {'walks': <Object?>[]}));
    expect(await fetchNearbyWalks(harness.api, const GeoPoint(55.7512345678, 37.6)), isEmpty);
    expect(harness.server.sent.single.query, {'lat': '55.751235', 'lon': '37.600000'});
  });
}
