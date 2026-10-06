import { CATALOG_LISTED_AT, rankTopWalks, ratingSummary } from "./walk-top.mjs";
import { catalogWalkView, listedCatalogRoutes } from "./walk-catalog.mjs";
import { computeWalkEntry } from "./walk-entry.mjs";
import { resolveWalkView } from "./walk-view.mjs";

export const NEARBY_RADIUS_M = 500;
export const NEARBY_LIMIT = 5;

/**
 * Where an open walk ends, as on the walk page: the chosen destination, else the last stop.
 * null for a loop, which returns to its start.
 */
export const finishOf = document => document.mode === "loop" ? null : (document.destination ?? document.stops.at(-1)?.place)?.address ?? null;

/**
 * Walks that pass near a point, ranked by the top formula: catalog walks, approved public
 * account walks and, for a signed-in user, their own walks. Items carry only a rounded approach
 * distance and remaining-route totals — never coordinates, launch counts, owners or authors.
 * @param {{ accountStore: any, store: any, builtinRoutes: any[] }} options
 */
export function createNearbyWalks({ accountStore, store, builtinRoutes }) {
  return {
    /** @param {{lat: number, lon: number, userId?: string | null}} point */
    list({ lat, lon, userId = null }) {
      const origin = { lat, lon };
      const { walks, catalogRatings, priorMean } = accountStore.listPassingCandidates({ userId });
      const launches = accountStore.launchTotals();
      const catalog = listedCatalogRoutes(builtinRoutes).flatMap(route => {
        const published = store.getPublishedWalk(route.id);
        if (!published) return [];
        const rating = catalogRatings.get(route.id) ?? { ratingSum: 0, ratingCount: 0 };
        return [{ key: `catalog:${route.id}`, kind: "catalog", id: route.id, title: String(published.title ?? route.title), route: published,
          ...rating, launches: launches.get(`catalog:${route.id}`) ?? 0, listedAt: CATALOG_LISTED_AT }];
      });
      // The store returns each walk once; an own walk that is also published stays "own".
      const account = walks.map(walk => ({ key: `account:${walk.id}`, kind: walk.own ? "own" : "shared", id: walk.own ? walk.id : walk.shareToken,
        walkId: walk.id, title: walk.title, ratingSum: walk.ratingSum, ratingCount: walk.ratingCount, launches: launches.get(`account:${walk.id}`) ?? 0,
        listedAt: (walk.own ? walk.listedAt ?? walk.updatedAt : walk.listedAt) ?? CATALOG_LISTED_AT }));
      // Rank visible metadata, then inspect routes in batches until enough nearby walks qualify.
      const ranked = rankTopWalks([...catalog, ...account], { priorMean, limit: Infinity });
      const result = [];
      for (let start = 0; start < ranked.length && result.length < NEARBY_LIMIT; start += NEARBY_LIMIT) {
        const batch = ranked.slice(start, start + NEARBY_LIMIT);
        const documents = accountStore.getNearbyDocuments(batch.filter(item => item.kind !== "catalog").map(item => item.walkId), userId);
        for (const item of batch) {
          if (result.length >= NEARBY_LIMIT) break;
          let document, view;
          try {
            if (item.kind === "catalog") {
              view = catalogWalkView(item.route);
              document = view.document;
            } else document = documents.get(item.walkId);
          } catch { continue; }
          const entry = computeWalkEntry(document, origin, NEARBY_RADIUS_M);
          if (!entry) continue;
          if (!view) {
            try { view = resolveWalkView(document, 0, store); }
            catch { continue; }
          }
          const chapters = view.chapters.slice(entry.entryIndex);
          const audioSeconds = chapters.reduce((sum, chapter) => sum + (chapter.audio?.durationSec ?? 0), 0);
          result.push({ kind: item.kind, id: item.id, title: item.title,
            distanceM: entry.distanceM, walkingMinutes: entry.walkingMinutes, stopCount: entry.stopCount,
            finish: finishOf(document), rating: ratingSummary(item), startDistanceM: entry.startDistanceM,
            entryStopId: entry.entryStopId, audioMinutes: Math.ceil(audioSeconds / 60),
            audioComplete: chapters.length > 0 && chapters.every(chapter => chapter.audio !== null) });
        }
      }
      return result;
    },
  };
}
