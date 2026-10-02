import { distanceMeters } from "./open-data.mjs";
import { isTransientError, sleep, withRetry } from "./retry.mjs";

const fail = code => Object.assign(new Error(code), { code });
const coordinate = (value, max) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
export const validLocation = location => coordinate(location?.lat, 90) && coordinate(location?.lon, 180);

/** Keep only public source fields needed for editorial assessment. Never store comments or photos. */
export function sourceRecord(raw) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.title !== "string" || !raw.title.trim()
    || !validLocation(raw.location)) throw fail("WIKIMAPIA_INVALID_PLACE");
  return {
    id: raw.id, title: raw.title, description: typeof raw.description === "string" ? raw.description : "",
    url: `https://wikimapia.org/${raw.id}/ru`, location: { lat: raw.location.lat, lon: raw.location.lon },
    deleted: raw.is_deleted === true, categories: Array.isArray(raw.tags) ? raw.tags.map(tag => tag.title).filter(title => typeof title === "string") : [],
  };
}

/** A candidate shortlist, NOT an identity decision: declensions, initials and adjacent objects need review. */
export function candidateMatches(place, records) {
  if (!validLocation(place) || typeof place.name !== "string") throw fail("WIKIMAPIA_INVALID_INPUT");
  const words = text => text.toLowerCase().replaceAll("ё", "е").match(/[а-яa-z0-9]+/gu) ?? [];
  const generic = new Set(["памятник", "мемориальная", "доска", "скульптура", "музей", "бюст", "имени", "могила", "обелиск", "монумент", "парк"]);
  const tokens = words(place.name).filter(word => word.length >= 3 && !generic.has(word));
  if (!tokens.length) return [];
  return records.filter(record => !record.deleted && validLocation(record.location)).map(record => {
    const titleWords = words(record.title);
    const matched = tokens.filter(word => titleWords.some(other => word === other
      || (word.length >= 5 && other.length >= 5 && word.slice(0, -2) === other.slice(0, word.length - 2)))).length;
    return { ...record, distanceM: Math.round(distanceMeters(place, record.location)), nameCoverage: matched / tokens.length };
  }).filter(record => record.distanceM <= 150 && record.nameCoverage >= 0.5)
    .sort((a, b) => b.nameCoverage - a.nameCoverage || a.distanceM - b.distanceM || a.id - b.id);
}

/** One serial client per process. Tests inject the clock, transport and wait without making real requests. */
export function createWikimapiaClient({ apiKey = "", example = false, intervalMs = 3100, fetchImpl = fetch,
  wait = sleep, now = Date.now, timeoutMs = 25000 } = {}) {
  const key = apiKey || (example ? "example" : "");
  if (!key) throw fail("WIKIMAPIA_KEY_REQUIRED");
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw fail("WIKIMAPIA_INVALID_INTERVAL");
  const interval = Math.max(key === "example" ? 31000 : 3100, intervalMs);
  let lastStart = -Infinity, queue = Promise.resolve();
  const request = (method, params) => {
    const result = queue.then(() => withRetry(async () => {
      await wait(Math.max(0, interval - (now() - lastStart)));
      lastStart = now();
      const url = new URL("https://api.wikimapia.org/");
      url.search = new URLSearchParams({ key, function: method, language: "ru", format: "json", ...params }).toString();
      let response;
      /** @type {any} */
      let data;
      try {
        response = await fetchImpl(url.href, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(fail(`WIKIMAPIA_HTTP_${response.status}`), { status: response.status, retryAfter: response.headers.get("retry-after") });
        }
        data = await response.json();
      } catch (error) {
        // No raw fetch error, URL, server message or cause may reveal the API key.
        if (Number.isInteger(error?.status)) throw error;
        throw Object.assign(fail("WIKIMAPIA_TRANSPORT_ERROR"), {
          transient: error?.name === "TimeoutError" || isTransientError(error),
        });
      }
      if (data?.debug?.code || data?.error) throw fail(`WIKIMAPIA_API_${Number(data?.debug?.code) || "ERROR"}`);
      return data;
    }, { attempts: 3, baseMs: 2000, maxMs: 60000, wait, isTransient: error =>
      (error instanceof Error && "transient" in error && error.transient === true) || isTransientError(error) }));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    async nearest(place) {
      if (!validLocation(place)) throw fail("WIKIMAPIA_INVALID_INPUT");
      const data = await request("place.getnearest", { lat: String(place.lat), lon: String(place.lon), count: "50" });
      if (!Array.isArray(data?.places)) throw fail("WIKIMAPIA_INVALID_RESPONSE");
      return data.places.map(sourceRecord);
    },
    async detail(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw fail("WIKIMAPIA_INVALID_ID");
      const data = await request("place.getbyid", { id: String(id), data_blocks: "main,location" });
      const record = sourceRecord(data);
      if (record.id !== id) throw fail("WIKIMAPIA_ID_MISMATCH");
      return record;
    },
  };
}
