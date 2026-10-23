import 'dart:convert';
import 'dart:io';

/// A fixture generated from the site's TypeScript (src/**/*.mobile-export.test.ts).
Map<String, Object?> loadFixture(String relative) =>
    jsonDecode(File('test/fixtures/$relative').readAsStringSync()) as Map<String, Object?>;

Map<String, Object?> asMap(Object? value) => value! as Map<String, Object?>;

List<Object?> asList(Object? value) => value! as List<Object?>;

/// JSON has no NaN/Infinity: the fixtures encode them as strings.
double number(Object? value) => switch (value) {
  'NaN' => double.nan,
  'Infinity' => double.infinity,
  '-Infinity' => double.negativeInfinity,
  final num value => value.toDouble(),
  _ => throw ArgumentError.value(value, 'value', 'not a fixture number'),
};
