import { catalogWalkView, listedCatalogRoutes } from "./walk-catalog.mjs";
import metroData from "./metro-stations.json" with { type: "json" };
import { nearestMetro, routeMapPreview, routePreview } from "./walk-top-preview.mjs";

export const TOP_LIMIT = 20;
export const TOP_PRIOR_WEIGHT = 5;
export const CATALOG_LISTED_AT = new Date(0).toISOString();

export const TOP_DURATIONS = ["up-to-30", "31-to-60", "61-to-90"];
export function matchesTopDuration(minutes, duration) {
  if (!duration) return true;
  if (duration === "up-to-30") return minutes <= 30;
  if (duration === "31-to-60") return minutes > 30 && minutes <= 60;
  if (duration === "61-to-90") return minutes > 60 && minutes <= 90;
  return false;
}

/** Bayesian-smoothed rating multiplied by ln(1 + launches); zero launches score zero. */
export function topScore({ ratingSum, ratingCount, launches }, { priorMean, priorWeight = TOP_PRIOR_WEIGHT }) {
  const rating = (priorWeight * priorMean + ratingSum) / (priorWeight + ratingCount);
  return rating * Math.log1p(launches);
}

/**
 * Orders candidates by score, then launches, rating count, listing time (newer first) and key.
 * @template {{key: string, ratingSum: number, ratingCount: number, launches: number, listedAt: string}} T
 * @param {T[]} candidates
 * @param {{priorMean: number, priorWeight?: number, limit?: number}} options
 * @returns {T[]}
 */
export function rankTopWalks(candidates, { priorMean, priorWeight = TOP_PRIOR_WEIGHT, limit = TOP_LIMIT }) {
  return candidates
    .map(candidate => ({ candidate, score: topScore(candidate, { priorMean, priorWeight }) }))
    .sort((a, b) => b.score - a.score
      || b.candidate.launches - a.candidate.launches
      || b.candidate.ratingCount - a.candidate.ratingCount
      || (a.candidate.listedAt < b.candidate.listedAt ? 1 : a.candidate.listedAt > b.candidate.listedAt ? -1 : 0)
      || (a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0))
    .slice(0, limit)
    .map(item => item.candidate);
}

/** Card details of a walk document, or null for a draft without a route. */
export const walkDetails = document => document?.route
  ? { walkingMinutes: document.route.walkingMinutes, distanceM: document.route.distanceM, stopCount: document.stops.length }
  : null;

/** The walk document of a catalog route, or null when its editorial data does not form a valid walk. */
export const catalogDocument = route => { try { return catalogWalkView(route).document; } catch { return null; } };

/** Card details of a catalog walk, or null when its editorial data does not form a valid walk. */
export const catalogDetails = route => walkDetails(catalogDocument(route));

/** Public rating summary: the average rounded to hundredths, null without reviews. */
export const ratingSummary = ({ ratingSum, ratingCount }) =>
  ({ average: ratingCount ? Math.round(ratingSum / ratingCount * 100) / 100 : null, count: ratingCount });

/**
 * Public ranking of catalog walks and editor-approved public account walks. Launch counts,
 * owners and authors never leave this module.
 * @param {{ accountStore: any, store: any, builtinRoutes: any[], limit?: number }} options
 */
export function createTopWalks({ accountStore, store, builtinRoutes, limit = TOP_LIMIT }) {
  return {
    list({ offset = 0, startMetro = "", endMetro = "", duration = "" } = {}) {
      const { walks, catalogRatings, priorMean } = accountStore.listTopCandidates();
      const launches = accountStore.launchTotals();
      const catalog = listedCatalogRoutes(builtinRoutes).flatMap(route => {
        const published = store.getPublishedWalk(route.id);
        if (!published) return [];
        const rating = catalogRatings.get(route.id) ?? { ratingSum: 0, ratingCount: 0 };
        return [{ key: `catalog:${route.id}`, kind: "catalog", id: route.id, title: String(published.title ?? route.title), route: published,
          ...rating, launches: launches.get(`catalog:${route.id}`) ?? 0, listedAt: CATALOG_LISTED_AT }];
      });
      const account = walks.map(walk => ({ key: `account:${walk.id}`, kind: "shared", id: walk.shareToken, walkId: walk.id, title: walk.title,
        ratingSum: walk.ratingSum, ratingCount: walk.ratingCount, launches: launches.get(`account:${walk.id}`) ?? 0, listedAt: walk.listedAt ?? CATALOG_LISTED_AT }));
      // Decode in small batches: invalid or route-less walks do not count toward a page.
      const ranked = rankTopWalks([...catalog, ...account], { priorMean, limit: Infinity });
      const valid = [];
      for (let start = 0; start < ranked.length; start += limit) {
        const batch = ranked.slice(start, start + limit);
        const documents = accountStore.getTopDocuments(batch.filter(item => item.kind === "shared").map(item => item.walkId));
        for (const item of batch) {
          const document = item.kind === "catalog" ? catalogDocument(item.route) : documents.get(item.walkId);
          const meta = walkDetails(document);
          if (!meta) continue;
          const geometry = Array.isArray(document.route.geometry) ? document.route.geometry : [];
          const start = document.start?.location ?? geometry[0];
          const end = geometry.at(-1);
          const loopEnd = document.mode === "loop" && start && end && Math.abs(start.lat - end.lat) < 0.0005 && Math.abs(start.lon - end.lon) < 0.0005;
          valid.push({ item, document, geometry, meta,
            startMetro: nearestMetro(start, metroData.stations, document.start?.address),
            endMetro: nearestMetro(end, metroData.stations, loopEnd ? document.start?.address : "") });
        }
      }
      const stations = part => [...new Set(valid.flatMap(walk => walk[part] ? [walk[part].name] : []))].sort((a, b) => a.localeCompare(b, "ru"));
      const filtered = valid.map((walk, rank) => ({ ...walk, rank: rank + 1 }))
        .filter(walk => (!startMetro || walk.startMetro?.name === startMetro)
          && (!endMetro || walk.endMetro?.name === endMetro)
          && matchesTopDuration(walk.meta.walkingMinutes, duration));
      const page = filtered.slice(offset, offset + limit);
      return { walks: page.map(({ item, geometry, meta, rank, startMetro: start, endMetro: end }) => ({
        kind: item.kind, id: item.id, title: item.title, ...meta, rating: ratingSummary(item), rank,
        preview: routePreview(geometry), mapPreview: routeMapPreview(geometry), startMetro: start, endMetro: end,
      })), total: filtered.length, nextOffset: offset + page.length < filtered.length ? offset + page.length : null,
      filters: { starts: stations("startMetro"), ends: stations("endMetro") } };
    },
  };
}
