export type Coordinates = { lat: number; lon: number };
export type Place = { address: string; location: Coordinates };
export type StoryRef = { kind: "job" | "osm" | "catalog"; id: string } | null;
export type WalkStop = { id: string; place: Place; storyRef: StoryRef; placeId?: string; transition: string; nextHint: string; triggerLocation?: Coordinates };
export type WalkDocument = {
  version: 2; id: string; title: string; description: string; city: "Москва"; mode: "open" | "loop";
  minutes: number; start: Place | null; destination?: Place | null; stops: WalkStop[];
  // tunnels: covered stretches as [a, b] vertex ranges of geometry (see validTunnels in backend/walk-document.mjs).
  route: { geometry: Coordinates[]; distanceM: number; walkingMinutes: number; attribution: string; tunnels?: Array<[number, number]> } | null;
  fieldChecked: boolean;
};
export type WalkStory = { title: string; address: string; paragraphs: Array<{ text: string; factIds: string[] }>;
  sources: Array<{ id: string; title: string; url: string; publisher: string }>;
  facts: Array<{ id: string; claim: string; sourceIds: string[] }>; checkedAt?: string };
export type ContentLocale = "ru" | "en" | "zh";
export type WalkLocalization = { requestedLocale: ContentLocale; contentLocale: ContentLocale; fallbackReason: null | "missing" | "draft" | "stale" };
export type WalkAudio = { url: string; sha256: string; durationSec: number; language?: ContentLocale };
export type WalkView = { document: WalkDocument; sourceDocument?: WalkDocument; documentLocalization?: WalkLocalization | null; revision: number; contentVersion: string; requestedLocale?: ContentLocale;
  chapters: Array<{ id: string; status: "not_requested" | "preparing" | "text_ready" | "ready" | "failed" | "review_required" | "insufficient_evidence" | "unavailable";
    story: WalkStory | null; audio: WalkAudio | null; localization?: WalkLocalization | null }> };

export const walkRequestedLocale = (view: Pick<WalkView, "requestedLocale">): ContentLocale => view.requestedLocale ?? "ru";
export const chapterContentLocale = (chapter: WalkView["chapters"][number]): ContentLocale => chapter.localization?.contentLocale ?? "ru";

export { validateWalkDocument, migrateLegacyDraft, validateWalkView } from "../../../backend/walk-document.mjs";
