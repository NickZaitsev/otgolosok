# Walk Planner Backend

`POST /api/walk-plan` is independent of the story provider, job queue, and paid generation. It requires `Content-Type: application/json`, an `Origin` exactly matching `APP_ORIGIN`, and an absent, `same-origin`, or `none` `Sec-Fetch-Site` header. Request bodies are limited to 8192 bytes; story endpoints retain their 2048-byte limit.

## Request

```json
{
  "start": {"address": "Москва, Арбат, 1", "location": {"lat": 55.752, "lon": 37.601}},
  "mode": "loop",
  "minutes": 30,
  "stops": [
    {"address": "Москва, Арбат, 10", "location": {"lat": 55.751, "lon": 37.596}}
  ]
}
```

- `start`, `mode`, and `minutes` are required. The UI should default to `loop`; omission of `mode` is an error.
- `mode` is `loop` (return to start) or `open` (end at the final stop).
- `minutes` is the number 30, 60, or 90, an upper bound on routed walking time, not a promise to fill the entire duration. Time at stops is not included.
- Omit `stops` for automatic discovery of 2-4 stops. Supply 1-5 stops for manual routing in exactly the supplied order. `[]`, `null`, and repeated points are invalid. Do not include the return-to-start point in `stops`.
- Each place has only `address` and `location`; locations have only numeric `lat` and `lon`. Unknown fields are rejected at every input level.
- Addresses are nonempty text, at most 240 characters, without control characters or angle brackets. Whitespace is normalized. Coordinates must be inside the shared Moscow service rectangle: latitude 55.48-55.98, longitude 37.30-37.95. This is a service boundary, not an administrative polygon. Supplied places must be at least 25 m apart, including start.
- Coordinates determine routing. This endpoint does not geocode or verify correspondence between a manually supplied address and its point; resolve addresses before submission.

## Success

```json
{
  "stops": [{"address": "Москва, Арбат, 10", "location": {"lat": 55.751, "lon": 37.596}}],
  "geometry": [{"lat": 55.752, "lon": 37.601}, {"lat": 55.7515, "lon": 37.5985}, {"lat": 55.751, "lon": 37.596}],
  "distanceM": 360,
  "walkingMinutes": 5,
  "attribution": "© OpenStreetMap contributors; pedestrian routing by Valhalla. Map information is not verified historical evidence."
}
```

The example is schematic, not an actual route. `geometry` in real responses is decoded exclusively from routed Valhalla pedestrian legs, in travel order. `stops` excludes start and the automatic return point. Distance is summed from leg lengths and rounded to meters; walking time is summed from leg times and rounded up to minutes. Routing can snap to the walking network within 150 m of each requested point. No straight-line or driving fallback is used.

Automatic discovery queries named OSM buildings tagged historic, heritage, or museum, with both street and house number. Search radius is `min(1800, minutes * 20)` meters. Invalid names, addresses, coordinates, duplicate buildings, and out-of-radius results are discarded. Up to four stops are ordered by nearest neighbor from start. The actual walking route must fit the requested duration, a 90 m/min distance ceiling, and a detour ceiling of `max(1200 m, 4 * direct waypoint distance)`. Over-budget automatic routes drop the final stop and retry, down to two stops, with at most three routing calls. Manual routes never reorder or silently remove stops. Discovery is heuristic, not a globally optimal tour search.

OSM labels and tags are map information, not verified historical facts. Historical claims remain the responsibility of the story research pipeline.

## Configuration

- **Required:** `WALK_ROUTER_URL` is the complete Valhalla `/route` endpoint, for example `http://127.0.0.1:8002/route`. Run a Valhalla instance with current Moscow OSM tiles and pedestrian costing enabled, or configure a compatible hosted service whose usage policy permits your deployment. No public router is assumed reliable or enabled by default. Unset configuration returns `503 WALK_UNAVAILABLE`.
- **Optional:** `WALK_OVERPASS_URL` is an Overpass interpreter endpoint; default `https://overpass-api.de/api/interpreter`. Respect its usage policy and availability; configure your own instance for sustained production use. Manual routing never calls Overpass.
- Valhalla requests explicitly set `costing: pedestrian`, kilometer units, polyline6 shapes, and break locations. Do not point this setting at OSRM or a driving-only router. Upstreams are trusted operator configuration, never URLs from user input. HTTP is supported for local deployment; use HTTPS for remote providers.
- `APP_ORIGIN` must match the frontend origin. No OpenAI key or story provider is needed. No external paid generation is invoked.

The planner has a process-local one-request concurrency gate and a two-second minimum interval between accepted requests, a 12-second total deadline covering discovery and all routing attempts, a 1 MiB limit per upstream response, a 12,000-point geometry limit, and no redirects. Overpass has an eight-second query timeout and requests at most 160 elements. Network failures, malformed results, inconsistent geometry, and timeouts fail closed. The injected `createWalkPlanner({fetchImpl, now, routerUrl, overpassUrl, timeoutMs, minIntervalMs})` enables isolated tests; `createApp({planWalk})` accepts an injected planner.

For multiple server processes, add shared rate limiting at the reverse proxy. The application gate is global within a process, not per-client, so it limits upstream consumption but does not provide fair access between users. Keep reverse-proxy request/body timeouts enabled as well.

## Errors

Responses have `{ "error": { "code": "WALK_INVALID", "message": "..." } }`, with public Russian messages and no upstream details.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `WALK_INVALID` | Invalid JSON, oversized body, or invalid parameters |
| 403 | No walk-specific code | Same-origin check failed |
| 404 | `WALK_NOT_FOUND` | Too few candidates or no acceptable route within the limits |
| 429 | `WALK_BUSY` | Gate or cooldown active; `Retry-After: 2` |
| 503 | `WALK_UNAVAILABLE` | Router unset, upstream failure, malformed result, or deadline exceeded |

Run mocked backend tests with Node 24 or newer: `node --test backend/*.test.mjs`. Tests make no live routing, discovery, or generation requests.
