# Plan: Automatic walks fill the chosen duration

Status: plan, 2026-09-28.

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.

## Context

A user chose an automatic 60-minute walk (no destination, "ordinary walk", not the research flow) and got a ~10-minute route. Root cause is in the automatic planner `createWalkPlanner` (`backend/walks.mjs`):

- Without a destination, stops are chosen by pure greedy nearest-neighbour from the start, up to `AUTO_STOP_LIMITS[minutes]` (`{30:5,60:8,90:10}`) — `backend/walks.mjs` ~lines 207–212.
- The chosen duration is only an upper bound: a route is accepted when `seconds<=minutes*60 && distanceM<=minutes*90 && distanceM<=max(1200,direct*4)` (~line 133). There is no lower bound.
- The bundled catalog (`backend/walk-discovery-catalog.mjs`, 2129 Moscow elements) plus the map catalog (`store.listWalkCandidates`) are dense in the centre, so the 8 nearest notable buildings form a tight cluster ≈10 minutes of walking regardless of the chosen 60 minutes.
- Also in this path, candidates are ordered by distance only; `contentRank`/`catalogRank` priority (published audio > story > none; map catalog > fallback OSM) is applied only in the destination path, contradicting `docs/agents/walk-routing-selection.md`.

Routing uses self-hosted Valhalla (`WALK_ROUTER_URL`, `compose.yaml` service `valhalla`, `/route` with `costing:'pedestrian'`) — no per-call cost, but every call counts against the planner's total `timeoutMs` (12 s) deadline.

## Approved decisions

1. `minutes` keeps meaning **walking time only** (UI label "Время пешком"); listening time at stops is not budgeted. `walkingMinutes <= minutes` stays the hard upper bound everywhere (frontend validators, walk document).
2. Target band for automatic walks without a destination: **walking time ≥ 75 % of the chosen duration** (30 → ≥ 23 min, 60 → ≥ 45, 90 → ≥ 68; use `Math.ceil`-free comparison `seconds >= 0.75*minutes*60`).
3. When the band cannot be reached (sparse area, few candidates), return the **longest valid in-budget route** found, and the UI shows an honest note, e.g. «Рядом нашлось мест только на 18 мин из 60». No API/contract change: the frontend compares `route.walkingMinutes` with the requested `minutes`.
4. In the same change, the loop/open-without-destination path gives priority to ready content (`contentRank`, then `catalogRank`), as the destination path already does.
5. Scope: both `mode:'loop'` and `mode:'open'` **without** destination, automatic selection only. Manual stops and destination routes keep current behaviour.

## Key codebase facts

- `backend/walks.mjs`:
  - `createWalkPlanner({fetchImpl, now, routerUrl, overpassUrl, discoveryElements, candidateProvider, timeoutMs=12000, minIntervalMs=2000})` returns `planWalk(input)`; input `{start, mode, minutes∈{30,60,90}, stops?, destination?}`; `manual = Object.hasOwn(input,'stops')`.
  - `routeStops(stops)` does one Valhalla call and returns a public route `{stops, geometry, distanceM, walkingMinutes, attribution}` or `null` when (a) a leg is zero-length (snapped onto same access point), (b) legs are disconnected (>10 m gap), or (c) the route is over budget / enormous detour. It throws `WALK_NOT_FOUND` on Valhalla `error_code 442` and `WALK_UNAVAILABLE` on malformed data. Callers currently cannot tell "over budget" from "unusable" `null`.
  - Discovery radius: `min(4050, minutes*90/(loop?2:1))` m. Candidates are built by `addCandidate` with `{address, location, catalogId, contentRank, catalogRank, contentId?}` and deduplicated.
  - Without destination: nearest-neighbour chain (`candidates.sort(by distance from current)`), then `while(true)` routes and drops the last stop until it fits; `WALK_NOT_FOUND` when ≤2 stops still fail; `WALK_STOPS_NOT_FOUND` when fewer than 2 candidates.
  - The whole `run()` races a single `deadline` of `timeoutMs`; errors other than `WALK_NOT_FOUND`/`WALK_STOPS_NOT_FOUND`/`WALK_DISCOVERY_UNAVAILABLE` become `WALK_UNAVAILABLE` (`WALK_DISCOVERY_UNAVAILABLE` while `discovering`).
  - Valhalla pedestrian default speed ≈ 5.1 km/h (≈85 m/min); the existing distance cap uses 90 m/min.
- `backend/server.mjs:65` wires the planner with `candidateProvider: store.listWalkCandidates` (`backend/content-store.mjs:127`); `POST /api/walk-plan` at ~line 427 maps error codes to Russian messages.
- `backend/walks.test.mjs` (node:test): helper `route(request, time=100)` gives every leg a **constant** time regardless of length, and `fixture(handler)` creates a planner with Overpass discovery. New duration tests need a router mock where leg time is proportional to leg length (e.g. `time = lengthKm*1000/1.4`).
  Existing tests that pin current behaviour and must stay green or be consciously updated: `automatic ${mode} selects ordered addressed buildings`, `automatic over-budget routes shorten, never return a fabricated fallback` (asserts exactly 4 router calls), `too few automatic candidates fail honestly`, `automatic loop uses a ${expected}-stop cap for ${minutes} minutes`.
- Frontend:
  - `src/features/walk-builder/use-walk-draft.ts:236` posts to `/api/walk-plan`; `selection: "auto"|"manual"` is React state only (not persisted), line 39.
  - `src/features/walk-builder/walk-creation-panel.tsx:114` renders the route summary (`walkingMinutes` «мин пешком», km).
  - Pure helpers live in `src/features/walk-builder/model.ts` with vitest tests in `model.test.ts`.
- Docs: `docs/agents/walk-routing-selection.md` (Russian) describes stop selection and must be updated.

## Implementation

### 0. Reproduce first
Add a failing test in `backend/walks.test.mjs`: a dense grid of ≥20 notable candidates spaced ~100 m around `start`, a length-proportional router mock, `{mode:'loop', minutes:60}` → assert `walkingMinutes >= 45` and `<= 60`. It must fail on the current code (the nearest-8 cluster).

### 1. Make `routeStops` report why a route was rejected (`backend/walks.mjs`)
Refactor to an internal `measureRoute(stops)` returning `null` for unusable routes (zero-length leg, disconnected legs) and otherwise `{route, seconds, distanceM, fits}` where `fits` is the existing budget/detour predicate. Keep `routeStops` behaviour for manual and destination callers (they use `fits ? route : null`). No change to thrown errors.

### 2. Budget-aware chain selection for automatic routes without destination
Add module-level constants: `MIN_BUDGET_SHARE = 0.75`, `WALK_METERS_PER_MINUTE = 85`, `STRAIGHT_TO_WALK = 1.3`, `MAX_AUTO_ROUTE_ATTEMPTS = 8`.

Add a pure function (exported for tests or tested through `planWalk`):
`selectChain({start, candidates, stopLimit, spacingM, loop, straightBudgetM}) → candidate[]`
- Walk from `current = start`. Eligible candidate `c`: not chosen; `distance(current,c) >= spacingM`; `distance(c, p) >= spacingM/2` for every already chosen point incl. start (prevents zig-zag back); `used + distance(current,c) + (loop ? distance(c,start) : 0) <= straightBudgetM`.
- Choice among eligible: those within `distance(current,c) <= max(spacingM*1.5, spacingM+150)` are ordered by `contentRank` desc, `catalogRank` desc, distance asc; if that window is empty, take the nearest eligible. With `spacingM = 0` this degrades to today's nearest-neighbour plus rank priority inside a 150 m window.
- Stop when `stopLimit` reached or nothing eligible.

In `run()`, replace the no-destination branch (nearest-neighbour + trim loop) with a bounded search:
- `budget = minutes*60`, `floor = MIN_BUDGET_SHARE*budget`, `straightBudgetM = minutes*WALK_METERS_PER_MINUTE/STRAIGHT_TO_WALK`.
- Start `spacingM = straightBudgetM/(stopLimit + (loop?1:0))`; search interval `[0, straightBudgetM/2]`.
- Each attempt: `selectChain` → if <2 stops, treat as "too short" (lower spacing); else `measureRoute`. `fits && seconds >= floor` → return immediately. `fits && seconds < floor` → remember as best if longer than current best, raise spacing (`lo = spacingM`). Not `fits` (over budget or detour) or `null` → lower spacing (`hi = spacingM`). Next `spacingM = (lo+hi)/2`. Skip an attempt whose chain equals an already measured chain (no duplicate router calls).
- At most `MAX_AUTO_ROUTE_ATTEMPTS` router calls in total, all inside the existing `timeoutMs` deadline.
- If no fitting route after the search: fall back to the existing "drop last stop" trimming on the `spacingM = 0` chain, counting against the same attempt cap; if the best-so-far exists, return it instead of trimming.
- Errors unchanged: `WALK_STOPS_NOT_FOUND` when fewer than 2 candidates survive discovery filters; `WALK_NOT_FOUND` when nothing fits within the budget.
- Keep `discovering=false` set before routing so router failures report `WALK_UNAVAILABLE`.

Destination and manual branches are untouched.

### 3. Frontend shortfall note
- `src/features/walk-builder/model.ts`: add `MIN_BUDGET_SHARE = 0.75` (comment that it mirrors the backend constant in `backend/walks.mjs`) and a pure helper `routeShortfall(route: Plan, minutes: number): number | null` returning `route.walkingMinutes` when `< MIN_BUDGET_SHARE*minutes`, else `null`.
- `walk-creation-panel.tsx`: under `.creation-summary`, when `selection === "auto"`, `!draft.destination` and `routeShortfall(...)` is not null, render a muted note: «Рядом нашлось мест только на {N} мин из {minutes}. Выберите другое начало или добавьте остановки вручную.» Use existing classes / design tokens (`ui-muted` or the panel's existing note style); no new component.
- Known limitation: `selection` is not persisted, so after reload a manual route defaults to `auto`; the note may then appear for a short manual loop. Acceptable; mention in the doc update rather than persisting new state.

### 4. Docs
Update `docs/agents/walk-routing-selection.md` (Russian): the chosen time is walking time; automatic routes without a destination aim for ≥75 % of it by spacing stops, with a bounded number of Valhalla attempts; ready content wins within the spacing window; a shorter route is returned with a UI note when the area is sparse.

## Testing & verification

Backend (`node --test backend/*.test.mjs`), in `backend/walks.test.mjs`, with a length-proportional router mock (no real Valhalla/Overpass):
- Repro test from step 0 passes; table-driven over `minutes ∈ {30,60,90}` × `mode ∈ {loop, open}`: result within `[0.75*budget, budget]`, stop count ≤ cap, loop geometry ends at start.
- Sparse area (3–4 candidates close to start): returns the longest fitting route below 75 %, not an error.
- Rank priority: two candidates at equal spacing, one with `readiness:'audio'` from `candidateProvider` → the audio one is chosen.
- Router attempt bound: a router mock that always returns over-budget → at most `MAX_AUTO_ROUTE_ATTEMPTS` calls, then `WALK_NOT_FOUND`.
- Unusable legs (zero-length / disconnected) during search do not abort the search.
- Update pinned tests (`over-budget routes shorten` call count, `stop-cap` expectations) only where the new algorithm legitimately changes them; keep their intent (no fabricated fallback, cap respected).

Frontend (`vitest`): `routeShortfall` table tests — boundary at exactly 75 %, below, above, `walkingMinutes === minutes`.

Run `npm run check` (or the project's lint + type-check + tests) before committing.

End-to-end: `docker compose up` with Valhalla, create an automatic 60-minute loop from a dense central start (e.g. Арбат) and from a sparse outskirts start; confirm ≥45 min in the first case and the shortfall note in the second. Record observed timings/attempt counts in `docs/agents/walk-routing-selection.md` if they reveal anything non-obvious.

## Out of scope

- Budgeting listening time at stops.
- Research flow (`backend/walk-research.mjs`, fixed 3 nearest candidates, radius `min(1800, minutes*20)`) — same symptom there, separate plan.
- Destination routes and manual stop routes.
- Changing `AUTO_STOP_LIMITS`, discovery radius, or the catalog.
- New API fields or persisting `selection`.

---
**Maintenance note (for the implementing agent):** when this plan is implemented, update the `Status:` line above, e.g. `Status: implemented YYYY-MM-DD in branch `feat/<name>``. If the plan changes during implementation, update the affected sections too — the plan must not lie about what was built.
