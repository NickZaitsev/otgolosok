import { CATALOG_LISTED_AT, catalogCandidates, catalogDocument, rankTopWalks, ratingSummary, walkDetails } from "./walk-top.mjs";

/** Walks per response: every public walk of the city fits, a runaway catalog does not flood the map. */
export const WALK_MAP_LIMIT = 300;
/** The widest area one request may ask for, in degrees: the whole of Moscow with a margin. */
export const WALK_MAP_MAX_SPAN = 2;
/** The overview line is a schematic: vertices closer than this to the simplified line are dropped. */
export const WALK_MAP_TOLERANCE_M = 6;

const METERS_PER_DEGREE = 6371000 * Math.PI / 180;
const round = (/** @type {number} */ value) => Math.round(value * 1e5) / 1e5;

/**
 * Douglas–Peucker in local metres, so the tolerance means the same on every street of the city.
 * @param {Array<{lat: number, lon: number}>} geometry
 * @param {number} toleranceM
 * @returns {Array<[number, number]>} [lat, lon] pairs rounded to about a metre
 */
export function simplifyLine(geometry, toleranceM = WALK_MAP_TOLERANCE_M) {
  const valid = geometry.filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
  if (valid.length < 2) return [];
  const cosine = Math.cos(valid[0].lat * Math.PI / 180);
  const xy = valid.map(point => [point.lon * cosine * METERS_PER_DEGREE, point.lat * METERS_PER_DEGREE]);
  const keep = new Set([0, xy.length - 1]);
  const stack = [[0, xy.length - 1]];
  while (stack.length) {
    const [first, last] = /** @type {[number, number]} */ (stack.pop());
    const [ax, ay] = xy[first], [bx, by] = xy[last];
    const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
    let largest = 0, chosen = -1;
    for (let index = first + 1; index < last; index += 1) {
      const [x, y] = xy[index];
      const ratio = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared)) : 0;
      const distance = Math.hypot(x - ax - ratio * (bx - ax), y - ay - ratio * (by - ay));
      if (distance > largest) { largest = distance; chosen = index; }
    }
    if (largest > toleranceM && chosen >= 0) { keep.add(chosen); stack.push([first, chosen], [chosen, last]); }
  }
  const line = [...keep].sort((a, b) => a - b).map(index => /** @type {[number, number]} */ ([round(valid[index].lat), round(valid[index].lon)]));
  // Rounding can merge neighbours; a repeated vertex only adds bytes.
  return line.filter((point, index) => index === 0 || point[0] !== line[index - 1][0] || point[1] !== line[index - 1][1]);
}

/** @param {Array<[number, number]>} line */
const boundsOf = line => ({
  south: Math.min(...line.map(point => point[0])), north: Math.max(...line.map(point => point[0])),
  west: Math.min(...line.map(point => point[1])), east: Math.max(...line.map(point => point[1])),
});

/** The overview of a walk document: card details, simplified line and its bounds; null for a walk that cannot be drawn. */
function overviewOf(document) {
  const meta = walkDetails(document);
  if (!meta || !Array.isArray(document.route.geometry)) return null;
  const line = simplifyLine(document.route.geometry);
  return line.length < 2 ? null : { meta, line, bounds: boundsOf(line) };
}

/**
 * Public walks drawn as overview lines on the map: catalog walks and editor-approved public
 * account walks, the same set as the top. Only the route line and card details leave this
 * module — never launch counts, owners, authors or private walks.
 *
 * Simplified lines of account walks are kept by revision, so a request decodes only walks that
 * are new or changed since the previous one and filters the rest by their stored bounds.
 * @param {{ accountStore: any, store: any, builtinRoutes: any[], limit?: number }} options
 */
export function createWalkMap({ accountStore, store, builtinRoutes, limit = WALK_MAP_LIMIT }) {
  /** @type {Map<string, {revision: number, overview: ReturnType<typeof overviewOf>}>} */
  const overviews = new Map();
  /** @param {Array<{walkId: string, revision: number}>} account */
  const refresh = account => {
    const current = new Set(account.map(item => item.walkId));
    for (const id of overviews.keys()) if (!current.has(id)) overviews.delete(id);
    const stale = account.filter(item => overviews.get(item.walkId)?.revision !== item.revision);
    if (!stale.length) return;
    const documents = accountStore.getTopDocuments(stale.map(item => item.walkId));
    for (const item of stale) {
      let overview = null;
      try { overview = overviewOf(documents.get(item.walkId)); } catch { overview = null; }
      overviews.set(item.walkId, { revision: item.revision, overview });
    }
  };
  return {
    /**
     * Walks whose line enters the area, best ranked first. `complete` is false when the limit
     * cut the list: the client must not treat such an area as fully loaded.
     * @param {{west: number, south: number, east: number, north: number}} area
     */
    list(area) {
      const { walks, catalogRatings, priorMean } = accountStore.listTopCandidates();
      const launches = accountStore.launchTotals();
      const account = walks.map(walk => ({ key: `account:${walk.id}`, kind: "shared", id: walk.shareToken, walkId: walk.id, revision: walk.revision, title: walk.title,
        ratingSum: walk.ratingSum, ratingCount: walk.ratingCount, launches: launches.get(`account:${walk.id}`) ?? 0, listedAt: walk.listedAt ?? CATALOG_LISTED_AT }));
      refresh(account);
      const ranked = rankTopWalks([...catalogCandidates({ builtinRoutes, store, catalogRatings, launches }), ...account], { priorMean, limit: Infinity });
      const result = [];
      let complete = true;
      for (const item of ranked) {
        let overview;
        try { overview = item.kind === "catalog" ? overviewOf(catalogDocument(item.route)) : overviews.get(item.walkId)?.overview; } catch { overview = null; }
        if (!overview) continue;
        const { bounds } = overview;
        if (bounds.west > area.east || bounds.east < area.west || bounds.south > area.north || bounds.north < area.south) continue;
        if (result.length >= limit) { complete = false; break; }
        result.push({ kind: item.kind, id: item.id, title: item.title, ...overview.meta, rating: ratingSummary(item), line: overview.line });
      }
      return { walks: result, complete };
    },
  };
}
