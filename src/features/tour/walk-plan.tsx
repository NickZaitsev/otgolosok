import type { TriggerConfig } from "@/lib/geo/types";
import type { Coordinates, HistoricalContent, Route, WalkStep } from "./types";

export type WalkChapter = WalkStep & { content: HistoricalContent; status?: WalkStep["status"] };

/**
 * Where the walk listens next. Each chapter belongs to the stop it describes, so
 * arriving at the following stop is what should start the following chapter.
 * The last chapter has nothing left to trigger and falls back to the finish.
 */
export function nextChapterTarget(chapters: WalkChapter[], index: number, fallback: Coordinates): Coordinates {
  const next = chapters[index + 1];
  return next?.trigger_location ?? next?.location ?? fallback;
}

export function chapterTriggerConfig(chapters: WalkChapter[], index: number, fallback: TriggerConfig): TriggerConfig {
  const trigger = chapters[index + 1]?.trigger;
  return trigger
    ? { enterM: trigger.enter_m, exitM: trigger.exit_m, minFixes: trigger.min_fixes, windowSize: fallback.windowSize, maxAccuracyM: trigger.max_accuracy_m }
    : fallback;
}

export function getWalkChapters(route: Route, includePending = false): WalkChapter[] {
  const contentById = new Map([...route.pois, ...(route.notes ?? [])].map((content) => [content.id, content]));
  return (route.walk?.steps ?? []).flatMap((step) => {
    const content = contentById.get(step.content_id);
    return content && (includePending || content.story.text_status === "ready") ? [{ ...step, content }] : [];
  });
}
