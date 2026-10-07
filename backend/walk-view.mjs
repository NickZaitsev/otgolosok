import { createHash } from "node:crypto";
import { publicJob } from "./domain.mjs";
import { validateWalkDocument, validateWalkView } from "./walk-document.mjs";
import { catalogWalkView } from "./walk-catalog.mjs";

const allowedUrl = value => typeof value === "string" && /^https:\/\/[^\s<>]+$/i.test(value) && value.length <= 2000;
const safeText = (value, limit) => typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

function safeStory(job) {
  const source = job?.story;
  if (!source || !safeText(source.title, 180) || !safeText(source.address ?? job.address, 180) || !Array.isArray(source.paragraphs)) return null;
  const sources = (Array.isArray(source.sources) ? source.sources : []).filter(item => safeText(item?.id, 128) && safeText(item?.title, 500) && allowedUrl(item.url))
    .map(item => ({ id: item.id, title: item.title, url: item.url, publisher: typeof item.publisher === "string" ? item.publisher.slice(0, 500) : "" })) ?? [];
  const sourceIds = new Set(sources.map(item => item.id));
  const facts = (Array.isArray(source.facts) ? source.facts : []).filter(item => safeText(item?.id, 128) && safeText(item?.claim, 2000) && Array.isArray(item.sourceIds))
    .map(item => ({ id: item.id, claim: item.claim, sourceIds: [...new Set(item.sourceIds.filter(id => sourceIds.has(id)))] })) ?? [];
  const factIds = new Set(facts.map(item => item.id));
  const paragraphs = source.paragraphs.filter(item => safeText(item?.text, 6000)).map(item => ({
    text: item.text, factIds: Array.isArray(item.factIds) ? [...new Set(item.factIds.filter(id => factIds.has(id)))] : [],
  }));
  if (!paragraphs.length) return null;
  return {
    title: source.title,
    address: source.address ?? job.address,
    paragraphs,
    sources,
    facts,
    ...(date(source.checkedAt) ? { checkedAt: source.checkedAt } : {}),
  };
}

export function safeWalkStory(job) {
  return safeStory(job);
}

function publishedPlaceStory(place, stop) {
  if (!place?.text?.story || place.id !== stop.storyRef.id) return null;
  const distance = Math.hypot((place.location.lat - stop.place.location.lat) * 111320,
    (place.location.lon - stop.place.location.lon) * 111320 * Math.cos(place.location.lat * Math.PI / 180));
  if (distance > 100) return null;
  return safeStory({ story: place.text.story, address: place.address || place.name });
}

function safeAudio(value) {
  if (!value || !Number.isFinite(value.durationSec) || value.durationSec <= 0 || value.durationSec > 7200 || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
  const isApiAudio = typeof value.url === "string" && /^\/api\/story-audio\/([a-f0-9]{64})\.mp3$/.test(value.url);
  const isCatalogAudio = typeof value.url === "string" && /^\/audio\/walk\/[a-zA-Z0-9-]+\.mp3$/.test(value.url);
  if (!isApiAudio && !isCatalogAudio) return null;
  if (isApiAudio && value.sha256 !== value.url.slice(-68, -4)) return null;
  return { url: value.url, sha256: value.sha256, durationSec: value.durationSec,
    ...(["ru", "en", "zh"].includes(value.language) ? { language: value.language } : {}) };
}

function catalogChapter(store, stop, requestedLocale) {
  const match = /^([a-z0-9][a-z0-9-]{0,127})--([a-z0-9][a-z0-9-]{0,127})$/.exec(stop.storyRef.id);
  if (!match) return null;
  const route = store.getPublishedWalk?.(match[1]);
  if (!route) return null;
  const stepIndex = (route.walk?.steps ?? []).findIndex(step => step.content_id === match[2] &&
    Math.hypot((step.location.lat - stop.place.location.lat) * 111320,
      (step.location.lon - stop.place.location.lon) * 111320 * Math.cos(step.location.lat * Math.PI / 180)) <= 100);
  if (stepIndex < 0) return null;
  const view = catalogWalkView(route, { requestedLocale });
  const chapter = view.chapters[stepIndex];
  return chapter ? { story: chapter.story, audio: chapter.audio ? safeAudio(chapter.audio) : null, localization: chapter.localization } : null;
}

const localized = (requestedLocale, contentLocale = requestedLocale, fallbackReason = null) => requestedLocale === "ru" ? {}
  : { localization: { requestedLocale, contentLocale, fallbackReason } };

function placeLocalization(place, requestedLocale) {
  if (requestedLocale === "ru") return null;
  const value = place?.text?.localization;
  if (value?.requestedLocale === requestedLocale && ["ru", "en", "zh"].includes(value.contentLocale)
      && (value.fallbackReason === null || ["missing", "draft", "stale"].includes(value.fallbackReason))) return value;
  return { requestedLocale, contentLocale: "ru", fallbackReason: "missing" };
}

// Resolving a view is deliberately synchronous: opening a walk never queues
// research or narration and only exposes already published content.
export function resolveWalkView(raw, revision, store, { requestedLocale = "ru" } = {}) {
  const document = validateWalkDocument(raw);
  const chapters = document.stops.map(stop => {
    if (!stop.storyRef) return { id: stop.id, status: "not_requested", story: null, audio: null, ...localized(requestedLocale) };
    if (stop.storyRef.kind === "osm") {
      const place = store.getPublishedPlace(stop.storyRef.id, ...(requestedLocale === "ru" ? [] : [{ requestedLocale }]));
      const localization = placeLocalization(place, requestedLocale);
      const story = publishedPlaceStory(place, stop);
      const candidateAudio = story ? safeAudio(place.text.audio) : null;
      const contentLocale = localization?.contentLocale ?? "ru";
      const audio = candidateAudio && (candidateAudio.language ?? "ru") === contentLocale ? candidateAudio : null;
      return { id: stop.id, status: story ? audio ? "ready" : "text_ready" : "unavailable", story, audio,
        ...(localization ? { localization } : {}) };
    }
    if (stop.storyRef.kind === "catalog") {
      const chapter = catalogChapter(store, stop, requestedLocale);
      return { id: stop.id, status: chapter?.story ? chapter.audio ? "ready" : "text_ready" : "unavailable", story: chapter?.story ?? null, audio: chapter?.audio ?? null,
        ...(requestedLocale === "ru" ? {} : { localization: chapter?.localization ?? { requestedLocale, contentLocale: "ru", fallbackReason: "missing" } }) };
    }
    if (stop.storyRef.kind !== "job") return { id: stop.id, status: "unavailable", story: null, audio: null, ...localized(requestedLocale) };
    const saved = store.get(stop.storyRef.id);
    if (!saved || (saved.kind ?? "address") !== "address" || saved.irrelevant) return { id: stop.id, status: "unavailable", story: null, audio: null, ...localized(requestedLocale, "ru", "missing") };
    let job;
    try { job = publicJob(saved); }
    catch { return { id: stop.id, status: "unavailable", story: null, audio: null, ...localized(requestedLocale, "ru", "missing") }; }
    if (job.address.normalize("NFKC").toLocaleLowerCase("ru").replace(/\W/gu, "") !== stop.place.address.normalize("NFKC").toLocaleLowerCase("ru").replace(/\W/gu, "")) return { id: stop.id, status: "unavailable", story: null, audio: null, ...localized(requestedLocale, "ru", "missing") };
    const story = job.stage === "ready" ? safeStory(job) : null;
    const audio = story ? safeAudio(job.audio) : null;
    const localizedAudio = requestedLocale === "ru" || !audio ? audio : { ...audio, language: "ru" };
    const status = story ? audio ? "ready" : "text_ready"
      : ["failed", "review_required", "insufficient_evidence"].includes(job.stage) ? job.stage : "preparing";
    return { id: stop.id, status, story, audio: localizedAudio, ...localized(requestedLocale, "ru", "missing") };
  });
  let responseDocument = document;
  let documentLocalization;
  if (requestedLocale !== "ru") {
    if (typeof store.getWalkLocalization === "function") {
      const result = store.getWalkLocalization(document, requestedLocale);
      responseDocument = validateWalkDocument(result?.document);
      documentLocalization = result?.localization;
    } else if (typeof store.localizeWalkDocument === "function") {
      responseDocument = validateWalkDocument(store.localizeWalkDocument(document, requestedLocale));
      const translated = JSON.stringify(responseDocument) !== JSON.stringify(document);
      documentLocalization = { requestedLocale, contentLocale: translated ? requestedLocale : "ru", fallbackReason: translated ? null : "missing" };
    } else {
      documentLocalization = { requestedLocale, contentLocale: "ru", fallbackReason: "missing" };
    }
  }
  const sourceDocument = requestedLocale !== "ru" && JSON.stringify(responseDocument) !== JSON.stringify(document) ? document : undefined;
  const localizedView = requestedLocale === "ru" ? chapters : { requestedLocale, document: responseDocument, sourceDocument, documentLocalization, chapters };
  const contentVersion = createHash("sha256").update(JSON.stringify(localizedView)).digest("hex");
  return validateWalkView({ document: responseDocument, ...(sourceDocument ? { sourceDocument } : {}),
    ...(requestedLocale === "ru" ? {} : { requestedLocale, documentLocalization }), revision, contentVersion, chapters });
}
