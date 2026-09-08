import type { HistoricalContent, Route, WalkStep } from "./types";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

// Keep route geometry, sources and fact links from the bundled catalogue. Only
// a complete, matching publication can replace a chapter's text and recording.
export function applyPublishedRoute(base: Route, value: unknown): Route {
  if (!record(value) || value.id !== base.id || !record(value.walk) || !Array.isArray(value.walk.steps) || !base.walk || value.walk.steps.length !== base.walk.steps.length || !Array.isArray(value.pois) || (value.notes !== undefined && !Array.isArray(value.notes))) return base;
  const content = [...value.pois, ...(value.notes ?? []) as unknown[]];
  const replacements = new Map<string, HistoricalContent["story"]>();
  const steps: WalkStep[] = [];
  for (let index = 0; index < base.walk.steps.length; index++) {
    const original = base.walk.steps[index];
    const next = value.walk.steps[index];
    const source = [...base.pois, ...(base.notes ?? [])].find(item => item.id === original.content_id);
    const candidate = content.find(item => record(item) && item.id === original.content_id);
    if (!source || !record(candidate) || !record(candidate.story) || !Array.isArray(candidate.story.paragraphs) || candidate.story.paragraphs.length !== source.story.paragraphs.length || !record(next) || next.id !== original.id || next.content_id !== original.content_id || !text(next.title, 200) || !text(next.transition, 2000) || !text(next.next_hint, 2000)) return base;
    const paragraphs: HistoricalContent["story"]["paragraphs"] = [];
    for (let p = 0; p < source.story.paragraphs.length; p++) {
      const old = source.story.paragraphs[p];
      const paragraph = candidate.story.paragraphs[p];
      if (!record(paragraph) || paragraph.id !== old.id || !text(paragraph.text, 4000) || !paragraph.text.trim() || JSON.stringify(paragraph.fact_ids) !== JSON.stringify(old.fact_ids)) return base;
      paragraphs.push({ ...old, text: paragraph.text });
    }
    const audio = next.audio;
    if (!record(audio) || !text(audio.url, 250) || !(audio.url === original.audio?.url || /^\/api\/story-audio\/[a-f0-9]{64}\.mp3$/.test(audio.url)) || typeof audio.duration_sec !== "number" || !Number.isFinite(audio.duration_sec) || audio.duration_sec <= 0 || audio.duration_sec > 600 || audio.synthetic !== true || !text(audio.model, 100) || !text(audio.voice, 64) || !text(audio.script_sha256, 64) || !text(audio.audio_sha256, 64) || !text(audio.generated_at, 100)) return base;
    steps.push({ ...original, title: next.title, transition: next.transition, next_hint: next.next_hint, duration_sec: audio.duration_sec, audio: audio as WalkStep["audio"] });
    replacements.set(original.content_id, { ...source.story, paragraphs });
  }
  return { ...base, walk: { ...base.walk, steps },
    pois: base.pois.map(item => ({ ...item, story: replacements.get(item.id) ?? item.story })),
    notes: base.notes?.map(item => ({ ...item, story: replacements.get(item.id) ?? item.story })),
  };
}
