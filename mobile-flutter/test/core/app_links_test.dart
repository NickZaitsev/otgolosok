import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/links/app_links.dart';

void main() {
  final origin = Uri.parse('https://otgolosok.online');

  group('inAppLocation', () {
    final cases = <String, String?>{
      'https://otgolosok.online/': '/',
      'https://otgolosok.online': '/',
      'https://otgolosok.online/place/node/123': '/?place=osm%3Anode%3A123',
      'https://otgolosok.online/place/way/9?lang=en': '/?place=osm%3Away%3A9',
      'https://otgolosok.online/place/node/0': null,
      'https://otgolosok.online/place/street/1': null,
      'https://otgolosok.online/?place=osm:relation:5': '/?place=osm%3Arelation%3A5',
      'https://otgolosok.online/?place=../api': '/',
      'https://otgolosok.online/walk?catalog=arbat&fromStop=s1&utm=x': '/walk?catalog=arbat&fromStop=s1',
      'https://otgolosok.online/en/walk?share=abc': '/walk?share=abc',
      'https://otgolosok.online/zh': '/',
      'https://otgolosok.online/walk/': '/walk',
      'https://otgolosok.online/admin': null,
      'https://otgolosok.online/api/me': null,
      'https://evil.example/walk': null,
      'http://otgolosok.online/walk': null,
      '/walk?id=1': '/walk?id=1',
    };
    for (final MapEntry(key: input, value: expected) in cases.entries) {
      test(input, () => expect(inAppLocation(Uri.parse(input), origin), expected));
    }
  });

  test('placeSharePath keeps the Russian link bare and tags other languages', () {
    expect(placeSharePath('osm:node:123'), '/place/node/123');
    expect(placeSharePath('osm:way:5', locale: 'zh'), '/place/way/5?lang=zh');
    expect(() => placeSharePath('node:1'), throwsArgumentError);
  });
}
