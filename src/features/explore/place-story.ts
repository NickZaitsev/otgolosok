import { useCallback, useEffect, useState } from "react";
import type { Coordinates } from "../tour/types";
import { RequestError, fetchWithRetry } from "../walk-builder/request";
import { mapCellStore } from "./map-cells";
import { openDataAttribution, type SourceAttribution, type StorySourceRef } from "./source-attribution";
import { isLocale, type Locale } from "@/lib/i18n/locale";

/** A place photo from our origin or an approved Flickr embed, with its author and source shown in the viewer. */
export type PlacePhoto = {
  src: string;
  thumbnail: string;
  width: number;
  height: number;
  alt: string;
  author: string | null;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
};
/** What the map index knows about a point (backend/map-cells.mjs `toMapPoint`): enough to open a linked place before its cell loads. */
export type PlaceHeader = { title: string; address: string; location: Coordinates };
export type PlaceStory = {
  paragraphs: string[];
  /** Language of the returned editorial text; legacy responses are Russian. */
  actualLocale: Locale;
  attribution?: SourceAttribution;
  audioUrl?: string;
  durationSec?: number;
  photo?: PlacePhoto;
  place?: PlaceHeader;
};
export type PlaceStoryState = { status: "idle" | "loading" | "ready" | "missing" | "error"; story?: PlaceStory; retry: () => void };

const CACHE_LIMIT = 100;
// Reopening a story within the session makes no request; the browser HTTP cache revalidates the rest by ETag.
const stories = new Map<string, PlaceStory>();

const storyKey = (id: string, locale: Locale) => `${locale}:${id}`;

function remember(key: string, story: PlaceStory) {
  stories.delete(key);
  stories.set(key, story);
  if (stories.size > CACHE_LIMIT) stories.delete(stories.keys().next().value as string);
}

const PHOTO_PATH = /^(?:\/api\/place-images\/[a-f0-9]{64}|\/images\/places\/[a-z0-9-]+)\.jpg$/;
const FLICKR_IMAGE = /^https:\/\/live\.staticflickr\.com\/\d+\/(\d+)_([a-f0-9]+)_(q|b)\.jpg$/;
const FLICKR_PAGE = /^https:\/\/www\.flickr\.com\/photos\/[^/?#]+\/(\d+)\/?$/;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const webUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; }
  catch { return undefined; }
};
const size = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;

/** The photo of a place detail; anything malformed means no photo, never a broken story. */
export function parsePlacePhoto(value: unknown): PlacePhoto | undefined {
  if (!value || typeof value !== "object") return undefined;
  const photo = value as Record<string, unknown>;
  const local = typeof photo.thumbnail === "string" && PHOTO_PATH.test(photo.thumbnail) && typeof photo.src === "string" && PHOTO_PATH.test(photo.src);
  const flickrThumb = typeof photo.thumbnail === "string" && FLICKR_IMAGE.exec(photo.thumbnail);
  const flickrFull = typeof photo.src === "string" && FLICKR_IMAGE.exec(photo.src);
  const flickr = flickrThumb && flickrFull && flickrThumb[1] === flickrFull[1] && flickrThumb[2] === flickrFull[2] &&
    flickrThumb[3] === "q" && flickrFull[3] === "b" && typeof photo.sourceUrl === "string" &&
    FLICKR_PAGE.exec(photo.sourceUrl)?.[1] === flickrFull[1];
  const thumbnail = local || flickr ? photo.thumbnail as string : undefined;
  const src = local || flickr ? photo.src as string : undefined;
  const width = size(photo.width), height = size(photo.height), alt = text(photo.alt), license = text(photo.license);
  const sourceUrl = webUrl(photo.sourceUrl), licenseUrl = webUrl(photo.licenseUrl);
  if (photo.author !== null && typeof photo.author !== "string") return undefined;
  if (!thumbnail || !src || !width || !height || !alt || !license || !sourceUrl || !licenseUrl) return undefined;
  return { thumbnail, src, width, height, alt, author: text(photo.author) ?? null, sourceUrl, license, licenseUrl };
}

const coordinate = (value: unknown, limit: number) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;

/** The title and address as the map index shows them: the story title, else the place name; the address, else the name. */
function parsePlaceHeader(place: { name?: unknown; address?: unknown; location?: unknown }, storyTitle: unknown): PlaceHeader | undefined {
  const location = place.location as { lat?: unknown; lon?: unknown } | null | undefined;
  const lat = coordinate(location?.lat, 90), lon = coordinate(location?.lon, 180), name = text(place.name);
  if (lat === undefined || lon === undefined || !name) return undefined;
  return { title: text(storyTitle) ?? name, address: text(place.address) ?? name, location: { lat, lon } };
}

const fallbackReasons = new Set(["missing", "draft", "stale"]);
const validLocale = (value: unknown): value is Locale => typeof value === "string" && isLocale(value);
const invalidStory = () => new Error("Некорректный ответ рассказа.");

/** Validates the server's localization decision. An omitted block is a legacy Russian response. */
function contentLocale(value: unknown, requestedLocale: Locale): Locale {
  if (value === undefined) return "ru";
  if (!value || typeof value !== "object") throw invalidStory();
  const localization = value as Record<string, unknown>;
  const requested = localization.requestedLocale, content = localization.contentLocale, fallback = localization.fallbackReason;
  if (!validLocale(requested) || !validLocale(content) || requested !== requestedLocale) throw invalidStory();
  if (requested === content) {
    if (fallback !== null) throw invalidStory();
  } else if (content !== "ru" || typeof fallback !== "string" || !fallbackReasons.has(fallback)) throw invalidStory();
  return content;
}

/** Maps `GET /api/content/places/:id` to the sheet body; a body without a published text is malformed. */
export function parsePlaceStory(value: unknown, requestedLocale: Locale = "ru"): PlaceStory {
  const place = (value as { place?: { name?: unknown; address?: unknown; location?: unknown; text?: { story?: unknown; audio?: unknown; localization?: unknown }; photo?: unknown } } | null)?.place;
  const placeText = place?.text;
  const story = placeText?.story as { title?: unknown; paragraphs?: unknown; sources?: unknown } | null | undefined;
  if (!story || typeof story !== "object" || !Array.isArray(story.paragraphs)) throw invalidStory();
  const actualLocale = contentLocale(placeText?.localization, requestedLocale);
  const paragraphs = (story.paragraphs as Array<{ text?: unknown } | null>)
    .map(paragraph => paragraph?.text).filter((paragraph): paragraph is string => typeof paragraph === "string" && paragraph.trim().length > 0);
  const audio = placeText?.audio as { url?: unknown; durationSec?: unknown; language?: unknown } | null | undefined;
  if (audio?.language !== undefined && !validLocale(audio.language)) throw invalidStory();
  const audioUrl = typeof audio?.url === "string" && audio.url ? audio.url : undefined;
  if (audioUrl && (audio?.language ?? "ru") !== actualLocale) throw invalidStory();
  const durationSec = audioUrl && typeof audio?.durationSec === "number" && Number.isFinite(audio.durationSec) && audio.durationSec > 0 ? audio.durationSec : undefined;
  const attribution = openDataAttribution(Array.isArray(story.sources) ? story.sources as StorySourceRef[] : undefined);
  const photo = parsePlacePhoto(place?.photo);
  const header = place ? parsePlaceHeader(place, story.title) : undefined;
  return { paragraphs, actualLocale, ...(attribution ? { attribution } : {}), ...(audioUrl ? { audioUrl } : {}), ...(durationSec ? { durationSec } : {}), ...(photo ? { photo } : {}),
    ...(header ? { place: header } : {}) };
}

/** null: the story was unpublished after the map index was loaded. */
export async function loadPlaceStory(id: string, signal: AbortSignal, locale: Locale = "ru"): Promise<PlaceStory | null> {
  const key = storyKey(id, locale), cached = stories.get(key);
  if (cached) { remember(key, cached); return cached; }
  try {
    // no-cache: the browser revalidates its copy with the server ETag and hands a 304 back as the cached 200.
    const url = `/api/content/places/${id}${locale === "ru" ? "" : `?lang=${locale}`}`;
    const response = await fetchWithRetry(url, signal, { cache: "no-cache" });
    const story = parsePlaceStory(await response.json(), locale);
    remember(key, story);
    return story;
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) return null;
    throw error;
  }
}

type Pending = { promise: Promise<PlaceStory | null>; controller: AbortController; users: number };
const pending = new Map<string, Pending>();

/**
 * One request per place for every open consumer. The abort is deferred by a microtask so a StrictMode
 * remount or a second sheet of the same place picks the running request up instead of starting another.
 */
function acquireStory(id: string, locale: Locale) {
  const key = storyKey(id, locale);
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: Pending = { controller, users: 0, promise: loadPlaceStory(id, controller.signal, locale) };
    created.promise.then(() => undefined, () => undefined).finally(() => { if (pending.get(key) === created) pending.delete(key); });
    pending.set(key, created);
    entry = created;
  }
  const held = entry;
  held.users += 1;
  let released = false;
  return {
    promise: held.promise,
    release() {
      if (released) return;
      released = true;
      held.users -= 1;
      queueMicrotask(() => {
        if (held.users > 0) return;
        held.controller.abort();
        if (pending.get(key) === held) pending.delete(key);
      });
    },
  };
}

export function usePlaceStory(placeId: string | undefined, locale: Locale = "ru"): PlaceStoryState {
  const key = placeId ? storyKey(placeId, locale) : undefined;
  // The result belongs to one place and one attempt: anything else is still loading.
  const [state, setState] = useState<{ key: string; attempt: number; status: "ready" | "missing" | "error"; story?: PlaceStory } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!placeId || !key || stories.has(key)) return;
    let disposed = false;
    const request = acquireStory(placeId, locale);
    request.promise.then(story => {
      if (disposed) return;
      if (story) { setState({ key, attempt, status: "ready", story }); return; }
      setState({ key, attempt, status: "missing" });
      // The index still shows a gone story: refresh it so the marker disappears.
      void mapCellStore.revalidate();
    }, () => {
      if (!disposed) setState({ key, attempt, status: "error" });
    });
    return () => { disposed = true; request.release(); };
  }, [placeId, key, locale, attempt]);
  if (!placeId) return { status: "idle", retry };
  const cached = key ? stories.get(key) : undefined;
  if (cached) return { status: "ready", story: cached, retry };
  if (state && state.key === key && state.attempt === attempt) return { status: state.status, story: state.story, retry };
  return { status: "loading", retry };
}
