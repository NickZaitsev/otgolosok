import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/config.dart';
import 'package:otgolosok/features/legal/legal_links.dart';

void main() {
  test('every legal link points at a document the site publishes', () {
    // The site builds /legal/<document> from the keys of `legalTitles`.
    final source = File('../src/lib/legal/document-content.tsx').readAsStringSync();
    final titles = RegExp(r'export const legalTitles = \{([^}]*)\}').firstMatch(source)![1]!;
    final published = RegExp(r'''^\s*"?([a-z-]+)"?\s*:''', multiLine: true).allMatches(titles).map((m) => m[1]).toSet();
    for (final document in LegalDocument.values) {
      expect(published, contains(document.slug));
    }
  });

  test('documents open on the configured site origin', () {
    final config = AppConfig.parse('https://staging.otgolosok.online', dev: false);
    expect(config.siteUrl(LegalDocument.terms.path).toString(), 'https://staging.otgolosok.online/legal/terms');
  });
}
