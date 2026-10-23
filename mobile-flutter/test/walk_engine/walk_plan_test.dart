import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/route.dart';
import 'package:otgolosok/walk_engine/trigger.dart';
import 'package:otgolosok/walk_engine/walk_direction.dart';
import 'package:otgolosok/walk_engine/walk_plan.dart';
import 'package:otgolosok/walk_engine/walk_route.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import 'fixture_loader.dart';

Map<String, Object?> encodeStep(WalkStep step) => {
  'audio': step.audio == null ? null : {'duration_sec': step.audio!.durationSec, 'url': step.audio!.url},
  'duration_sec': step.durationSec,
  'id': step.id,
  'location': step.location.toJson(),
  'next_hint': step.nextHint,
  'place': step.place,
  'status': step.status?.wire,
  'title': step.title,
  'transition': step.transition,
  'trigger_location': step.triggerLocation?.toJson(),
};

StopStage stage(Object? value) => StopStage.values.byName(value! as String);

void main() {
  final fixture = loadFixture('engine/walk_plan.json');

  group('walk view → route → chapters, targets and legs', () {
    for (final item in asList(fixture['cases'])) {
      final sample = asMap(item);
      test(sample['name']! as String, () {
        final direction = WalkDirection.values.byName(sample['direction']! as String);
        final route = orientWalk(walkViewToRoute(WalkView.fromJson(sample['view'])), direction);
        final chapters = getWalkChapters(route, includePending: true);
        final ready = getWalkChapters(route);
        final finish = route.walk!.finish.location;

        expect([for (final chapter in chapters) chapter.id], sample['chapterIds']);
        expect([for (final chapter in ready) chapter.id], sample['readyChapterIds']);
        expect(route.walk!.start.location.toJson(), sample['start']);
        expect(finish.toJson(), sample['finish']);
        expect(hasFinishLeg(chapters, finish, defaultTriggerConfig.enterM), sample['finishLeg']);
        expect([for (final step in route.walk!.steps) encodeStep(step)], sample['steps']);
        expect([for (final point in route.walk!.path.coordinates) [point.lon, point.lat]], sample['path']);
        for (final target in asList(sample['targets'])) {
          final row = asMap(target);
          final index = row['index']! as int;
          final at = stage(row['stage']);
          final label = 'index $index, ${at.name}';
          expect(arrivalTarget(chapters, index, at, finish).toJson(), row['target'], reason: label);
          expect(arrivalTriggerConfig(chapters, index, at, defaultTriggerConfig).toJson(), row['config'], reason: label);
          expect(highlightedLeg(index, at, chapters.length), row['leg'], reason: label);
        }
      });
    }
  });

  test('followChapter keeps the walker at their stop when stops join', () {
    for (final item in asList(fixture['follow'])) {
      final row = asMap(item);
      final before = asList(row['before']).cast<String>();
      final after = asList(row['after']).cast<String>();
      expect(
        followChapter(before, after, row['index']! as int, stage(row['stage'])),
        row['result'],
        reason: '$before → $after at ${row['index']} ${row['stage']}',
      );
    }
  });

  test('highlightedLeg for every count, index and stage', () {
    for (final item in asList(fixture['legs'])) {
      final row = asMap(item);
      expect(
        highlightedLeg(row['index']! as int, stage(row['stage']), row['count']! as int),
        row['result'],
        reason: '$row',
      );
    }
  });
}
