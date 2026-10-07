import { createHash } from "node:crypto";
import { validateWalkView } from "./walk-document.mjs";

const SHARE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Share token of the published walk a catalogue walk moved to (its stories became catalogue places), else null. */
export const catalogMovedShare = route => typeof route?.moved_to_share === "string" && SHARE_TOKEN.test(route.moved_to_share) ? route.moved_to_share : null;

/** Catalogue walks offered in lists: with steps and not moved to a shared walk. */
export const listedCatalogRoutes = routes => routes.filter(route => route.walk?.steps?.length && !catalogMovedShare(route));

// The editorial catalogue remains its own data source. Its public projection
// uses the same ordered walk view as user-created routes.
export function catalogWalkView(route, { requestedLocale = "ru" } = {}) {
  const items = new Map([...(route.pois ?? []), ...(route.notes ?? [])].map(item => [item.id, item]));
  const cleanPlace = value => value.replace(/^Финиш:\s*/i, "");
  const stops = (route.walk?.steps ?? []).map(step => ({
    id: step.id, place: { address: cleanPlace(step.place), location: {lat:step.location.lat,lon:step.location.lon} },
    storyRef: { kind: "catalog", id: `${route.id}--${step.content_id}` }, transition: step.transition, nextHint: step.next_hint,
    ...(step.trigger_location ? { triggerLocation: step.trigger_location } : {}),
  }));
  const chapters = (route.walk?.steps ?? []).map(step => {
    const item = items.get(step.content_id);
    if (!item?.story?.paragraphs?.length || item.story.text_status !== "ready") return { id: step.id, status: "preparing", story: null, audio: null,
      ...(requestedLocale === "ru" ? {} : { localization: { requestedLocale, contentLocale: "ru", fallbackReason: "missing" } }) };
    const story = {
      title: step.title, address: step.place,
      paragraphs: item.story.paragraphs.map(paragraph => ({ text: paragraph.text, factIds: paragraph.fact_ids })),
      sources: (item.sources ?? []).map(source => ({ id: source.id, title: source.title, url: source.url, publisher: source.publisher })),
      facts: (item.facts ?? []).map(fact => ({ id: fact.id, claim: fact.claim, sourceIds: fact.evidence.map(proof => proof.source_id) })),
      checkedAt: item.story.checked_at,
    };
    const audio = step.audio ? {url:step.audio.url,sha256:step.audio.audio_sha256,durationSec:step.audio.duration_sec,
      ...(requestedLocale === "ru" ? {} : { language: "ru" })}:null;
    return { id: step.id, status: audio ? "ready" : "text_ready", story, audio,
      ...(requestedLocale === "ru" ? {} : { localization: { requestedLocale, contentLocale: "ru", fallbackReason: "missing" } }) };
  });
  return validateWalkView({
    document: {
      version: 2, id: route.id, title: route.title, description: route.subtitle, city: route.city,
      mode: "open", minutes: route.duration_min,
      start: { address: route.walk.start.address, location: route.walk.start.location },
      stops, route: { geometry: route.walk.path.coordinates.map(([lon,lat])=>({lat,lon})),
        distanceM: route.walk.distance_m, walkingMinutes: route.walk.walking_min, attribution: route.walk.path.provider,
        ...(route.walk.path.tunnels ? { tunnels: route.walk.path.tunnels } : {}) },
      fieldChecked: route.walk.field_checked,
    }, revision: 0, chapters,
    ...(requestedLocale === "ru" ? {} : { requestedLocale }),
    contentVersion: createHash("sha256").update(JSON.stringify(requestedLocale === "ru" ? chapters : { requestedLocale, chapters })).digest("hex"),
  });
}
