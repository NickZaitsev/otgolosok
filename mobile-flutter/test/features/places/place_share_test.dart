import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/places/place_share.dart';
import 'package:share_plus/share_plus.dart';

void main() {
  final origin = Uri.parse('https://otgolosok.online');

  group('placeShareUrl', () {
    test('a Russian link has no language', () {
      expect(placeShareUrl(origin, 'osm:way:42', AppLocale.ru).toString(), 'https://otgolosok.online/place/way/42');
    });

    test('another language is carried in the link', () {
      expect(placeShareUrl(origin, 'osm:node:7', AppLocale.zh).toString(), 'https://otgolosok.online/place/node/7?lang=zh');
    });
  });

  group('sharePlace', () {
    final url = Uri.parse('https://otgolosok.online/place/way/42');
    late List<String> copied;
    late List<ShareParams> shown;

    setUp(() {
      copied = [];
      shown = [];
    });

    Future<ShareOutcome> share(Future<ShareResultStatus> Function() sheet, {bool clipboardFails = false}) => sharePlace(
          title: 'Дом с башней',
          url: url,
          text: 'Дом с башней — история в «Отголоске»',
          dialogTitle: 'Поделиться',
          share: (params) {
            shown.add(params);
            return sheet();
          },
          copy: (text) async {
            if (clipboardFails) throw StateError('no clipboard');
            copied.add(text);
          },
        );

    test('the system sheet gets the text with the link', () async {
      expect(await share(() async => ShareResultStatus.success), ShareOutcome.shared);
      expect(shown.single.text, 'Дом с башней — история в «Отголоске» $url');
      expect(shown.single.subject, 'Дом с башней');
      expect(copied, isEmpty);
    });

    test('closing the sheet is not an error and copies nothing', () async {
      expect(await share(() async => ShareResultStatus.dismissed), ShareOutcome.cancelled);
      expect(copied, isEmpty);
    });

    test('an unavailable sheet falls back to the clipboard', () async {
      expect(await share(() async => ShareResultStatus.unavailable), ShareOutcome.copied);
      expect(copied, [url.toString()]);
    });

    test('a failing sheet falls back to the clipboard', () async {
      expect(await share(() async => throw StateError('no activity')), ShareOutcome.copied);
      expect(copied, [url.toString()]);
    });

    test('without a sheet and a clipboard the link must be copied by hand', () async {
      expect(await share(() async => throw StateError('no activity'), clipboardFails: true), ShareOutcome.manual);
    });
  });
}
