export type PlaybackChapter = { id: string; audioUrl: string; durationSec: number };

export type PlaybackCheckpoint = {
  version: 1;
  routeId: string;
  chapterId: string;
  audioUrl: string;
  positionSec: number;
};

export function playbackStorageKey(routeId: string) {
  return `otgolosok:playback:${routeId}`;
}

/** Only a checkpoint for the same recording may restore an audio offset. */
export function parsePlaybackCheckpoint(raw: string | null, routeId: string, chapters: PlaybackChapter[]): PlaybackCheckpoint | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || saved.routeId !== routeId || typeof saved.positionSec !== "number" || !Number.isFinite(saved.positionSec) || saved.positionSec < 0) return null;
    const chapter = chapters.find((item) => item.id === saved.chapterId && item.audioUrl === saved.audioUrl);
    if (!chapter || !Number.isFinite(chapter.durationSec) || chapter.durationSec <= 0) return null;
    return {
      version: 1, routeId, chapterId: chapter.id, audioUrl: chapter.audioUrl,
      positionSec: Math.min(saved.positionSec, chapter.durationSec),
    };
  } catch {
    return null;
  }
}

export function formatPlaybackTime(seconds: number) {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
