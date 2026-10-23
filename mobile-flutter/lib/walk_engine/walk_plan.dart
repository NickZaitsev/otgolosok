// Port of the pure functions of src/features/tour/walk-plan.tsx.
import 'dart:math' as math;

import 'distance.dart';
import 'route.dart';
import 'trigger.dart';

/// A step of the walk with its story (`WalkChapter` of walk-plan.tsx).
class RouteChapter {
  const RouteChapter(this.step, this.content);

  final WalkStep step;
  final HistoricalContent content;

  String get id => step.id;
  String get title => step.title;
  GeoPoint get location => step.location;
  GeoPoint? get triggerLocation => step.triggerLocation;
  StepAudio? get audio => step.audio;

  /// Where arriving at this stop is detected.
  GeoPoint get arrivalPoint => step.triggerLocation ?? step.location;
}

/// Where a universal walk stands at a chapter: on the way to its stop
/// (`approach`) or arrived there (`stop`).
enum StopStage { approach, stop }

RouteChapter? _at(List<RouteChapter> chapters, int index) =>
    index >= 0 && index < chapters.length ? chapters[index] : null;

/// Where the walk listens next after chapter [index]: the following stop, or
/// [fallback] (the finish) after the last one.
GeoPoint nextChapterTarget(List<RouteChapter> chapters, int index, GeoPoint fallback) =>
    _at(chapters, index + 1)?.arrivalPoint ?? fallback;

TriggerConfig _triggerConfigOf(RouteChapter? chapter, TriggerConfig fallback) {
  final trigger = chapter?.step.trigger;
  return trigger == null
      ? fallback
      : TriggerConfig(
          enterM: trigger.enterM,
          exitM: trigger.exitM,
          minFixes: trigger.minFixes,
          windowSize: fallback.windowSize,
          maxAccuracyM: trigger.maxAccuracyM,
        );
}

TriggerConfig chapterTriggerConfig(
  List<RouteChapter> chapters,
  int index,
  TriggerConfig fallback,
) => _triggerConfigOf(_at(chapters, index + 1), fallback);

/// On the way to a stop the walk listens for that stop; after arriving, for the next one.
GeoPoint arrivalTarget(
  List<RouteChapter> chapters,
  int index,
  StopStage stage,
  GeoPoint fallback,
) {
  if (stage == StopStage.stop) return nextChapterTarget(chapters, index, fallback);
  return _at(chapters, index)?.arrivalPoint ?? fallback;
}

TriggerConfig arrivalTriggerConfig(
  List<RouteChapter> chapters,
  int index,
  StopStage stage,
  TriggerConfig fallback,
) => stage == StopStage.stop
    ? chapterTriggerConfig(chapters, index, fallback)
    : _triggerConfigOf(_at(chapters, index), fallback);

/// The leg the walker should walk now: into the stop on the way to it, out of
/// it after arriving; index `chapterCount` at `approach` is the way to the finish.
int highlightedLeg(int index, StopStage stage, int chapterCount) {
  if (chapterCount == 0) return 0;
  return stage == StopStage.approach
      ? math.min(index, chapterCount)
      : math.min(index + 1, chapterCount);
}

/// Whether the walk goes on after the last stop: its finish lies outside the
/// last stop's arrival radius. Then index `chapters.length` is the way to the finish.
bool hasFinishLeg(List<RouteChapter> chapters, GeoPoint finish, double fallbackEnterM) {
  if (chapters.isEmpty) return false;
  final last = chapters.last;
  return distanceMeters(last.arrivalPoint, finish) >
      (last.step.trigger?.enterM ?? fallbackEnterM);
}

/// The steps that have their story; pending ones too when [includePending].
List<RouteChapter> getWalkChapters(Route route, {bool includePending = false}) {
  final contentById = <String, HistoricalContent>{
    for (final poi in route.pois) poi.id: poi.content,
  };
  final steps = route.walk?.steps ?? const <WalkStep>[];
  return [
    for (final step in steps)
      if (contentById[step.contentId] case final content?)
        if (includePending || content.story.textStatus == TextStatus.ready)
          RouteChapter(step, content),
  ];
}

/// The chapter index after stops joined the walk (`before` → `after`, chapter
/// ids in walking order; `before.length` is the way to the finish). The walker
/// stays with the stop they were at or walking to, unless a new stop lies on
/// the leg they are walking now: then that stop is the next to reach.
int followChapter(List<String> before, List<String> after, int index, StopStage stage) {
  final current = index >= 0 && index < before.length ? before[index] : null;
  var next = current == null ? after.length : after.indexOf(current);
  if (next < 0) next = math.min(index, after.length);
  if (stage == StopStage.approach && next > 0 && !before.contains(after[next - 1])) {
    next -= 1;
  }
  return next;
}
