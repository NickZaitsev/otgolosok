import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/checkpoint.dart';
import 'package:otgolosok/walk_engine/walk_direction.dart';

import 'fixture_loader.dart';

void main() {
  final fixture = loadFixture('engine/playback_progress.json');
  final chapters = [
    for (final item in asList(fixture['chapters']))
      PlaybackChapter(
        id: asMap(item)['id']! as String,
        audioUrl: asMap(item)['audioUrl']! as String,
        durationSec: number(asMap(item)['durationSec']),
      ),
  ];

  test('parsePlaybackCheckpoint accepts only the same recording', () {
    for (final item in asList(fixture['checkpoints'])) {
      final row = asMap(item);
      final raw = row['raw'] as String?;
      final result = parsePlaybackCheckpoint(raw, row['routeId']! as String, chapters);
      final label = raw == null ? 'null' : raw.substring(0, raw.length.clamp(0, 120));
      expect(result?.toJson(), row['result'], reason: label);
    }
  });

  test('a parsed checkpoint serializes to the text the site stores', () {
    final row = asList(fixture['checkpoints']).map(asMap).firstWhere((item) => item['result'] != null);
    final parsed = parsePlaybackCheckpoint(row['raw']! as String, 'walk', chapters)!;
    expect(parsed.serialize(), row['raw']);
    expect(parsePlaybackCheckpoint(parsed.at(12.5).serialize(), 'walk', chapters)!.positionSec, 12.5);
  });

  test('playbackStorageKey per locale', () {
    for (final item in asList(fixture['keys'])) {
      final row = asMap(item);
      final locale = PlaybackLocale.values.byName(row['locale']! as String);
      expect(playbackStorageKey(row['routeId']! as String, locale), row['key']);
    }
  });

  test('a reverse walk keeps its own checkpoint', () {
    expect(walkCheckpointKey('w', PlaybackLocale.ru, WalkDirection.forward), 'otgolosok:playback:w');
    expect(walkCheckpointKey('w', PlaybackLocale.en, WalkDirection.reverse), 'otgolosok:playback:w:en:reverse');
  });

  test('formatPlaybackTime', () {
    for (final item in asList(fixture['times'])) {
      final row = asMap(item);
      expect(formatPlaybackTime(number(row['seconds'])), row['text'], reason: '${row['seconds']}');
    }
    expect(formatPlaybackTime(double.infinity), '0:00');
  });
}
