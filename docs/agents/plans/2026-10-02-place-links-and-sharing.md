# Plan: Place links in the URL and a "Share" button with link previews

Status: plan, 2026-10-02.

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.

## Context

Today a catalog place opened on the home map (`/`) has no address of its own: the URL stays `/`, a reload loses the card, and there is no way to send a place to someone. The only story link is `/?job=<id>` for stories the user ordered (it geocodes the job address and is consumed by `router.replace`).

The user wants:

1. Opening a catalog place changes the URL to a link that opens the same place on any device — **by its identifier, never by coordinates**.
2. A "Поделиться" button for the place.
3. Link previews in messengers (Telegram, WhatsApp, VK) with the place title, a teaser and the photo.
4. **Changing the URL must never reload the page** (no document navigation, no router navigation, the map and the audio stay mounted).

The site is a Next 16 static export (`output: "export"`, one `out/index.html` for `/`), served by nginx; the API is a separate Node backend behind nginx (`/api/*`). A static page cannot carry per-place Open Graph tags, so previews come from a small backend-rendered page at a separate path that sends people on to the map.

No paid or external services are involved.

## Approved decisions

1. **Identifier, not coordinates.** The map URL is `/?place=<placeId>` with the raw catalog id, e.g. `/?place=osm:node:123` (colons are legal in a query; build the string by hand, do not use `URLSearchParams.toString()`, which writes `%3A`). The place and its position are resolved from `GET /api/content/places/:id`. Only ids matching `^osm:(node|way|relation):[1-9]\d{0,18}$` are accepted (it is the only public id format: `backend/server.mjs` `publicPlace` regex).
2. **Only catalog places** get URLs and the share button. Ordered stories (`?job=`), walk parts and stories being prepared keep today's behaviour (no URL change, no share).
3. **Every opened place is a history step.** Opening a catalog place pushes a new entry (`/` → `/?place=A` → `/?place=B`); Back returns to the previous place, Forward re-opens the next one, and the map re-centres on the restored place.
4. **Closing (×) is a new step "without a place".** Closing a collapsed card pushes `/`, so Back right after closing re-opens the same place (like undo). Closing an *expanded* card **replaces** its expanded entry with `/`, so Back lands on the collapsed entry of that place, not on the expanded state. Any other way the card of a catalog place goes away while its URL is shown (tapping an empty spot on the map, opening an ordered story) also pushes `/`.
5. **No reloads.** The URL is changed only with `history.pushState`/`history.replaceState` (patched by Next 16: they update `useSearchParams` without a navigation or a server request). Never `router.push/replace`, `location.*` assignment or `<Link>` for selecting/closing a place.
6. **A link opens the card collapsed** (as already decided for the expandable story sheet: a link or a reload never opens it expanded).
7. **Share button only in the expanded card**, as a text button "Поделиться" next to "Создать прогулку отсюда", for catalog places whose story loaded. On devices with the Web Share API it opens the system share sheet; otherwise (or if sharing fails for a reason other than the user cancelling) it copies the link and shows "Ссылка скопирована."; if the clipboard is unavailable it shows the link in a read-only field to copy by hand.
8. **Link previews now.** The shared link is `https://<origin>/place/<type>/<number>` (e.g. `/place/node/123` ↔ `osm:node:123`; no colons, so messengers do not percent-encode it). nginx proxies `/place/` to the backend, which returns a small HTML page with Open Graph tags (title, teaser, photo) and a script that replaces the location with `/?place=osm:node:123`. Crawlers do not run scripts and read the tags; people land on the map.
9. **Yandex.Metrika:** keep counting every URL change as a page view (`YandexMetrika` already tracks `pathname`+`search`); each opened place becomes a `/?place=…` hit. No code change.
10. **Out of the scope of history steps:** cards without a URL (ordered stories, walk parts) are not restored by Back/Forward.

## Key codebase facts

- `src/app/page.tsx` renders `<Suspense><CatalogTour/></Suspense>` → `TourExperience` → `AroundScreen` (`src/features/explore/around-screen.tsx`) while not walking. `AroundScreen` owns `selected` (story id), `focus` (`MapFocus`), `place` (the tapped house, `PlaceSheet`), `nearbyCenter`, the `?job=` effect (lines ~108–137, consumes the param with `router.replace`) and `closeCreation` (`router.replace("/")`).
- Paths that change `selected` today: `select(pin)` (marker tap, `selectRecommendation`), `findPlace` (`setSelected(undefined)`), `prepareStory` (`setSelected(job.id)`), the `?job=` effect, the story `onClose`, initial state from `openChapter`.
- Catalog pins are built in the `pins` memo from `useMapCatalog().places` (`id`, `placeId`, `title`, `address`, `location`, `duration`, `status: "Готово к прослушиванию" | "Текст готов"`, `hasPhoto`, `clusterable: true`). Cells load by viewport (`map-cells.ts`), so a linked place may not be in `pins` yet.
- `src/features/explore/place-story.ts`: `loadPlaceStory(id)` fetches `/api/content/places/${id}` with `fetchWithRetry` (bounded retries), caches up to 100 stories, maps 404 to `null`; `usePlaceStory(placeId)` → `{status: idle|loading|ready|missing|error, story, retry}` and dedupes requests (`acquireStory`). `parsePlaceStory` currently keeps only paragraphs, attribution, audio, photo — **not** title/address/location, although the response has them: `{place: {id, name, address, location: {lat, lon}, text: {story: {title, paragraphs, sources}, audio}, photo}}` (`backend/content-store.mjs` `getPublishedPlace` + `viewPlace`). The index point title is `story.title || name`, address `address ?? name` (`backend/map-cells.mjs` `toMapPoint`).
- `src/features/explore/story-pin.ts`: `StoryPin`, `isExpandableStory`. A catalog pin is `placeId !== undefined && chapter === undefined && jobId === undefined` (same test in `StorySheet`).
- `src/features/explore/around-sheets.tsx` `StorySheet`: expanded body (`peek === false`) renders heading, paragraphs, attribution, sources, note and `WalkFromHere` (`a.secondary a.bodyAction` link). Icons: `src/features/explore/icons.tsx` (`IconName` union; no share icon yet).
- `src/features/shell/use-expandable-sheet.ts`: `expand()` does `history.pushState({ otgolosokSheet: key }, "")` (no URL); `collapse()` → `history.back()` if the current entry is the sheet's; `dismiss({ keepHistoryEntry })`; popstate restores `expanded` from `event.state.otgolosokSheet`; on mount the key is stripped with `replaceState`. A story re-shown on its own expanded entry reopens expanded.
- Next 16 history (`node_modules/next/dist/client/components/app-router.js` ~lines 234–300, docs `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` "Native History API"): patched `pushState/replaceState(data, "", url)` copy `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE` from the current state into `data` **only when `data` has no `__NA`**, and only then apply `url` to the router (`ACTION_RESTORE`, no request) so `useSearchParams` follows. Data that already carries `__NA` is passed through untouched and the router does NOT see the new URL. Next's popstate handler **reloads the page when `event.state` lacks `__NA`**. Therefore: always pass a fresh object without Next keys (e.g. `{}`; `null` also works — Next fills it in, as `walk-library.tsx` `selectTab` does — but `{}` is used here for uniformity).
- `src/features/analytics/yandex-metrika.tsx` sends `trackPage(location.href)` on every `pathname`/`search` change (production only).
- `src/features/navigation/app-navigation.tsx`: "Рядом" is `<Link href="/">` (a soft navigation to `/`); while the story is expanded the navigation is hidden.
- Clipboard pattern with a manual fallback: `src/features/walks/walk-library.tsx` `copy()` ("Скопируйте ссылку: …").
- Backend: `backend/server.mjs` `createApp({ origin, staticDirectory, … })`, `origin` = `APP_ORIGIN` (production `https://otgolosok.online`, README: must equal the browser origin, no trailing slash). Public place route at ~line 580 (`readMethod && publicPlace` → `sendCacheableJson`). The local-preview static fallback (`staticDirectory`, ~line 692) handles any non-`/api/` GET, so the new route must come before it. Errors in the handler end up as JSON — the share route must answer its own 404 as HTML.
- `backend/http-cache.mjs`: `sendCacheableJson(req, res, body)` — strong ETag (`etagOf` from `map-cells.mjs`), `Cache-Control: no-cache`, br/gzip, 304, HEAD.
- Photos: `photo.src`/`photo.thumbnail` are same-origin paths (`/api/place-images/<sha>.jpg` or `/images/places/<…>.jpg`) with `width`/`height`/`alt`. Fallback image: `public/icons/icon-512.png` (512×512).
- nginx (`docker/nginx.conf`): `location /` serves static with `try_files … =404`; API locations include `snippets/api-proxy.conf` (proxy to `backend:3000`, private access log without query) and `snippets/security-headers.conf` (CSP `frame-ancestors …; object-src 'none'; base-uri 'self'`, nosniff, Referrer-Policy, Permissions-Policy without `web-share` — its default allowlist `self` permits `navigator.share`). Static pages carry their script/style CSP in a `<meta>` built by `scripts/build-content-security-policy.mjs`; a backend HTML page must send its own CSP header.
- Service worker (`public/sw.js`): navigations to `/` (any query) are served from the app shell cache; paths outside `APP_SHELL` (e.g. `/place/...`) go to the network untouched.
- Tests: Vitest (`pnpm test` also runs `node --test backend/*.test.mjs`); backend HTTP tests in `backend/server.test.mjs` publish a place with `/api/story-admin/content/places/osm:node:7/approve` and fetch `/api/content/places/osm:node:7`. E2E runs on `next dev --port 3217` with APIs mocked (`e2e/support/map-catalog.ts` `mockMapCatalog`, detail route regex `places\/[^/?]+`); the share page cannot be e2e-tested there (no backend) — cover it in backend tests.
- E2E fixtures use non-OSM ids (`openLongStory` in `e2e/support/scenarios.ts`: `id: "long-story"`). `e2e/story-sheet.spec.ts` "длинная история раскрывается…" asserts the URL stays `/` after Back and that Back after closing an expanded card opens nothing — both change with this plan.
- This branch may be shared with parallel sessions: commit only your own hunks, watch CRLF and HEAD moves; do not run e2e against someone else's dev server (use a separate worktree/port), never touch the shared `git stash`.

## Implementation

### 0. Preparation

- Re-read the Next 16 "Native History API" docs and re-verify the `app-router.js` facts above against the installed version.
- `git status`: note foreign changes and leave them alone.

### 1. Place link helpers — `src/features/explore/place-link.ts` (new, pure)

- `export const PLACE_PARAM = "place";`
- `export function isPlaceId(value: unknown): value is string` — `^osm:(node|way|relation):[1-9]\d{0,18}$`.
- `export function readPlaceParam(params: Pick<URLSearchParams, "get">): { id: string } | { invalid: true } | null` — `null` when absent, `invalid` for a present but malformed value.
- `export function placeMapUrl(id: string): string` → `/?place=osm:node:123` (raw colons).
- `export function placeSharePath(id: string): string` → `/place/node/123`; `export function placeShareUrl(id: string, origin: string): string`.
- Keep the backend's own regex in `backend/place-share.mjs` (step 6); a unit test on each side pins the same mapping.

### 2. Place detail carries its header — `src/features/explore/place-story.ts`

- Extend `PlaceStory` with `title: string`, `address: string`, `location: Coordinates` parsed from `place.text.story.title || place.name`, `place.address ?? place.name`, `place.location` (finite lat/lon). Missing/invalid header fields make the body malformed (throw, as for missing paragraphs).
- Extract a shared `catalogPin(point)` mapping (index point → `StoryPin`) into `story-pin.ts` and a `linkedPlacePin(id, story: PlaceStory): StoryPin` that produces the same fields from the detail (status strings identical, `hasPhoto: Boolean(story.photo)`, `duration: story.durationSec`, `clusterable: true`). `around-screen.tsx` uses `catalogPin` instead of its inline mapping.

### 3. URL ⇄ selected place — `src/features/explore/use-place-url.ts` (new) + `around-screen.tsx`

Contract (the URL is the source of truth for the selected *catalog* place; local state keeps everything else):

- `usePlaceUrl()` returns `{ urlPlace: string | null; invalid: boolean; openPlace(id): void; leavePlace({ replace }?: { replace?: boolean }): void; replacePlaceUrl(id | null): void }`:
  - `urlPlace`/`invalid` from `useSearchParams()` via `readPlaceParam`.
  - `openPlace(id)`: if the current `location.search` already names `id`, no-op; otherwise `history.pushState({}, "", placeMapUrl(id))`.
  - `leavePlace()`: if the current URL has a `place` param, `history.pushState({}, "", "/")`; with `{ replace: true }` use `replaceState` (closing an expanded card, dropping a broken/missing link).
  - `replacePlaceUrl(id|null)`: `replaceState({}, "", id ? placeMapUrl(id) : "/")`.
  - Never use the router; always a fresh `{}` (Next completes it; see facts). Document this in the module comment.
- In `AroundScreen`:
  - **Sync on URL change** (render-time "adjust state on prop change" pattern, as `useExpandableSheet` does with `shownKey`): keep `[seenUrlPlace, setSeenUrlPlace]` initialised to `null`. When `urlPlace !== seenUrlPlace` and the screen is not in walk creation (`!creating` — the walk-builder URL has no `place`, its own params): set `seenUrlPlace = urlPlace`; if `urlPlace` → `setSelected(urlPlace)`, clear `place`/`placeBusy`/`placeError`, `setPrompt(false)`, and if it differs from the previous `selected` request a focus on it (step below); if `urlPlace === null` and `selected` is a place id (`isPlaceId`) → `setSelected(undefined)`. This single rule covers deep links, Back/Forward (Next updates `useSearchParams` on popstate), the "Рядом" link and the step-4 pushes.
  - **Focus**: keep `focusPlace: string | null` (state). When the sync selects a place: if its pin is in `pins` → `setFocus({...location})` now; otherwise remember the id and focus when the linked pin resolves (effect on `[focusPlace, linkedPin]`). Re-selecting the same id (collapse/expand popstate, same URL) must not refocus — the existing e2e "карта после раскрытия и сворачивания стоит на месте" depends on it.
  - **Linked pin**: `const linkedId = selected && isPlaceId(selected) && !catalogPins.some(p => p.id === selected) ? selected : undefined; const linked = usePlaceStory(linkedId);` when `linked.status === "ready"` append `linkedPlacePin(linkedId, linked.story)` to `pins` (catalog pin wins once its cell arrives — dedupe by id). `usePlaceStory` shares the request and cache with `StorySheet`, so the detail is fetched once.
  - **Link states** in the notices slot (`noticeList`), each with `role="status"`/`alert` like the existing notices: loading → "Открываем историю…"; error → "Не удалось открыть историю." + «Повторить» (`linked.retry`); missing (404) → "Эта история больше недоступна." and `replacePlaceUrl(null)`; `invalid` → "Ссылка на историю повреждена." and `replacePlaceUrl(null)`. Dismissible like `GeoNotice` (reuse its close pattern or a small `LinkNotice`). While a linked place is loading, the location prompt is not shown (`prompt && !active && !linkLoading …`).
  - **Writers** (all for catalog pins only, i.e. `isPlaceId(pin.id)` and the catalog shape):
    - `select(pin)`: catalog → `openPlace(pin.id)` + today's state updates; non-catalog → today's updates, and `leavePlace()` if a place URL is shown.
    - `findPlace`: `leavePlace()` when a place URL is shown (then today's logic).
    - `prepareStory` success: `leavePlace()` if needed (normally nothing is shown then).
    - Story `onClose`: catalog → if `reading.expanded`: `reading.dismiss({ keepHistoryEntry: true })` then `leavePlace({ replace: true })`; else `leavePlace()`; then today's resets. Non-catalog → unchanged (`reading.dismiss()`…).
    - `closeCreation`: replace the walk-builder entry with the story URL instead of `/`: `replacePlaceUrl(selected && isPlaceId(selected) ? selected : null)` via the history API (keeps the "no router navigation" rule; the existing `router.replace("/")` is replaced), then today's resets and focus restore.
    - The `?job=` effect is unchanged (its `router.replace` removes only `job`).
- `useExpandableSheet.expand()` (`src/features/shell/use-expandable-sheet.ts`): the pushed expanded entry must keep the URL (it does — no `url` argument) and must not carry Next keys; no other change is needed because the place lives in the URL. Add a test that the URL with `?place=` survives expand/collapse.

### 4. Share — `src/features/explore/share-place.ts` (new, pure) + `share-place-button.tsx` (new)

- `export type ShareOutcome = "shared" | "cancelled" | "copied" | "manual";`
- `export async function sharePlace(data: { title: string; url: string }, env: { share?: Navigator["share"]; canShare?: Navigator["canShare"]; writeText?: (text: string) => Promise<void> }): Promise<ShareOutcome>`:
  - payload `{ title, text: `${title} — история в «Отголоске»`, url }`;
  - if `share` exists and `canShare?.(payload) !== false` → `await share(payload)` → `"shared"`; `AbortError` → `"cancelled"`; any other error falls through to copying;
  - `writeText(url)` → `"copied"`; missing/throwing → `"manual"`.
- `ShareStoryButton({ placeId, title })`: `<button type="button" className={a.secondary + " " + a.bodyAction}>Поделиться <ExploreIcon name="share"/></button>`, builds `placeShareUrl(placeId, location.origin)`, calls `sharePlace` with `navigator.share?.bind(navigator)` etc., renders below the button: `"copied"` → `<p role="status">Ссылка скопирована.</p>`; `"manual"` → `<p role="status">Скопируйте ссылку:</p>` + `<input readOnly value={url} aria-label="Ссылка на историю" onFocus={select all}>`; `"shared"`/`"cancelled"` → nothing. The status resets when the place changes (key the component by `placeId`). Double taps while a share sheet is open are ignored (busy flag).
- `icons.tsx`: add `share` (a box with an arrow up, 24×24 stroke icon in the existing style).
- `StorySheet`: in the expanded section, for catalog places with `loaded.status === "ready"`, render `ShareStoryButton` right after/next to `WalkFromHere` (group both in a wrapper if spacing requires; follow `a.bodyAction` spacing). Not shown in the peek, for jobs, walk parts or missing stories.

### 5. Share page renderer — `backend/place-share.mjs` (new, pure)

- `export const SHARE_PATH = /^\/place\/(node|way|relation)\/([1-9]\d{0,18})$/;`
- `export function sharePathToPlaceId(pathname): string | null` → `osm:<type>:<n>`.
- `export function shareDescription(story, fallback)` — first non-empty paragraph, whitespace collapsed, cut to ≤ 200 characters at a word boundary with "…"; fallback the address/name.
- `export function renderPlaceSharePage({ id, place, origin })` → `{ status: 200 | 404, html, csp }`:
  - Published place: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" …><title>{title} — Отголосок</title><meta name="description">`, `<link rel="canonical" href="{origin}/place/{type}/{n}">`, Open Graph `og:site_name=Отголосок`, `og:locale=ru_RU`, `og:type=website`, `og:title`, `og:description`, `og:url` (the share URL — not the map URL, so scrapers that follow `og:url` stay on the preview), `og:image` = `{origin}{photo.src}` with `og:image:width/height/alt`, or `{origin}/icons/icon-512.png` (512×512) without a photo; `twitter:card` = `summary_large_image` with a photo, else `summary`. Body: the title, the teaser and `<a id="open" href="/?place={id}">Открыть историю на карте</a>`, then one constant inline script `location.replace(document.getElementById("open").href)`. **No `<meta http-equiv="refresh">`** (crawlers would follow it to the generic page). `location.replace` keeps the preview page out of the history, so Back from the map does not bounce.
  - Unknown/unpublished id: status 404, generic title "Отголосок — город говорит рядом", text "Эта история больше недоступна." and the same redirect to `/?place={id}` (the app explains and drops the param).
  - Every interpolated value is HTML-escaped (`& < > " '`); URLs are built only from `origin`, the validated id and the same-origin photo path (re-validate the photo path with the frontend's `PHOTO_PATH` rule — `^(?:/api/place-images/[a-f0-9]{64}|/images/places/[a-z0-9-]+)\.jpg$` — and drop the photo otherwise).
  - `csp`: `default-src 'none'; script-src 'sha256-<hash of the constant script>'; img-src 'self'; base-uri 'none'; form-action 'none'` (hash computed once at module load with `node:crypto`).

### 6. Backend route — `backend/server.mjs`, `backend/http-cache.mjs`

- `http-cache.mjs`: generalise to `sendCacheable(req, res, body, contentType, extraHeaders = {})`; keep `sendCacheableJson` as a thin wrapper (no behaviour change for JSON routes).
- `server.mjs`: right after the public place route, `if (readMethod && SHARE_PATH.test(url.pathname))`: resolve the id, `store.getPublishedPlace(id)`, render, and answer with `Content-Type: text/html; charset=utf-8`, the page CSP in `Content-Security-Policy`, `Referrer-Policy: strict-origin-when-cross-origin`; 200 via `sendCacheable` (ETag, `no-cache`, compression, HEAD), 404 with `Cache-Control: no-cache` and no ETag. Any other `/place/...` path → 404 HTML "Страница не найдена" with a link to `/` (not the JSON 404). Query strings (utm) are ignored. Store failures fall into the existing catch (500 JSON) — acceptable, logged by `logs.captureException`.
- `origin` comes from `createApp({ origin })` (`APP_ORIGIN`).

### 7. nginx — `docker/nginx.conf`

- Before `location /`: 
  ```
  # Shared place links: the backend renders Open Graph tags and sends people on to /?place=<id>.
  location ^~ /place/ {
      include /etc/nginx/snippets/api-proxy.conf;
      include /etc/nginx/snippets/security-headers.conf;
  }
  ```
  Keep the backend's `Cache-Control` (do not add `no-store`). nginx's CSP header (frame-ancestors, object-src, base-uri) and the backend's CSP header both apply; the backend's `base-uri 'none'` is stricter, which is fine.

### 8. Documentation

- New `docs/agents/place-links.md` (Russian): URL contract (`/?place=<id>`, strict id format, raw colons), history rules (each place a step, × pushes `/`, expanded × replaces, cards without URL are not restored), the "no reload" rule and the Next `__NA` details, linked-pin loading and notices, the share fallbacks, the share page (`/place/<type>/<n>`, OG tags, JS redirect without meta refresh, CSP hash, 404 behaviour), nginx location, Metrika counting each place as a page view, manual checks with real messengers if done. List it in `docs/agents/README.md` with a two-sentence description.
- `docs/agents/story-sheet-expansion.md`: the expanded entry now sits on `/?place=<id>`; Back after closing an expanded catalog card re-opens it collapsed.
- `README.md` (near the `/?job=<id>` paragraph): one sentence about `/?place=<id>` and the share link `/place/<type>/<n>`.

## Testing & verification

Unit (Vitest, `src/`):
- `place-link.test.ts` — table-driven `isPlaceId` (node/way/relation ok; `osm:node:0`, leading zero, 20 digits, `osm:area:1`, `../`, empty, encoded variants rejected), `readPlaceParam` (absent/valid/invalid, `%3A`-encoded value decodes to valid), `placeMapUrl` keeps raw colons, `placeSharePath`/`placeShareUrl` mapping.
- `place-story.test.ts` — the header fields are parsed (story title wins over name, address falls back to name), malformed location throws.
- `story-pin` — `catalogPin` and `linkedPlacePin` produce identical pins for the same place.
- `share-place.test.ts` — table-driven `sharePlace`: share succeeds → shared; `AbortError` → cancelled (no copy); `NotAllowedError` → copied; `canShare` false → copied; no share → copied; clipboard throws/missing → manual; payload text contains the title.
- `use-place-url.test.ts` (jsdom; mock `next/navigation` `useSearchParams` from `location.search`; spy on `history.pushState/replaceState`): `openPlace` pushes `{}` with `/?place=…` and is a no-op for the same id; `leavePlace` pushes `/` only when a place is shown; `{replace:true}` replaces; the pushed state never contains `__NA`.
- `around-sheets.test.ts` — expanded catalog story renders «Поделиться», peek/job/walk-part/missing do not.

Backend (`node --test`):
- `backend/place-share.test.mjs` — `sharePathToPlaceId` table (valid types, zero/leading zero/too long/unknown type rejected); `shareDescription` cut at a word boundary with "…", fallback; `renderPlaceSharePage` escapes `<`, `"`, `&` in title/description, uses the share URL in `og:url` and canonical, absolute `og:image` from origin+photo, icon fallback without photo, drops a photo with a foreign path, contains no `http-equiv="refresh"`, the script hash in `csp` matches the inline script; 404 variant.
- `backend/server.test.mjs` — after approving `osm:node:7`: `GET /place/node/7` → 200 `text/html`, CSP header present, OG title equals the story title, ETag + 304 on `If-None-Match`, `HEAD` has no body; `GET /place/node/8` (unpublished) → 404 HTML with the redirect link; `GET /place/foo` → 404 HTML (not JSON); with `staticDirectory` set, `/place/node/7` is still handled by the share route.

E2E (Playwright, `next dev`):
- Switch shared fixtures to production-format ids (`openLongStory` → `osm:node:1001`, and any fixture a new test relies on); fix selectors that used the old ids (`[title="…"]` stays by title).
- New `e2e/place-links.spec.ts`:
  - **No reload**: set `window.__noReload = 1`, keep a handle to the map container element and to the story `<audio>`; open place A (marker) → URL `/?place=osm:node:…`; open B → URL B; Back → A card, map re-centred on A; Forward → B; × → URL `/`, no card; Back → B re-opens collapsed. After all of this `window.__noReload === 1`, the map element is the same node, and no request with `_rsc` or to `index.txt`/document navigation happened (`page.on("request")` filter + `page.on("framenavigated")` count for the main frame stays at the initial load).
  - **Deep link**: `page.goto("/?place=<id of a place outside the initial cells>")` → notice "Открываем историю…" then the collapsed card with the title from the detail, the marker selected after its cell loads; the detail is requested once.
  - **Broken links**: `/?place=garbage` → "Ссылка на историю повреждена.", URL becomes `/`; `/?place=osm:node:999` (404) → "Эта история больше недоступна.", URL `/`; detail 500 → "Не удалось открыть историю." and «Повторить» recovers.
  - **Expanded close**: expand A, × → URL `/`; Back → A collapsed (not expanded); Back again leaves the place entry history as specified.
  - **Share**: in the expanded card «Поделиться» is visible (not in the peek); with `navigator.share` stubbed via `addInitScript` (records the payload, resolves) → payload `url` is `${origin}/place/node/…` and text contains the title; with share undefined and clipboard permission granted (`context.grantPermissions(["clipboard-read","clipboard-write"])` in Chromium) → "Ссылка скопирована." and the clipboard holds the URL; with share rejecting `AbortError` → nothing shown; with clipboard failing → read-only field with the URL.
  - **Walk builder**: from an expanded catalog card «Создать прогулку отсюда» → builder; × on the builder → URL `/?place=…` and the story card is back (no reload); Back from the builder → the expanded card (existing behaviour kept).
- Update `e2e/story-sheet.spec.ts` "длинная история раскрывается…": URL after Back is `/?place=<id>`; after closing the expanded card Back re-opens it collapsed (decision 4).
- Re-run `story-sheet.spec.ts`, `map-catalog.spec.ts`, `place-photo.spec.ts`, `map-story-job.spec.ts`, `navigation.spec.ts`, the layout matrix (`layout-invariants.spec.ts`; no new `KNOWN_LAYOUT_FAILURES`) — the share button adds height to the expanded body only.

Run before committing: `pnpm check` (lint incl. stylelint/prettier, typecheck, vitest + backend tests, Python tests, build), then `pnpm test:e2e` (on a free port / separate worktree if another session runs `next dev`). Browser check in the pane on 390×844: open places, Back/Forward, ×, deep link, the share fallback; screenshot of the expanded card with «Поделиться». The share page is checked via backend tests and `curl` against `pnpm generator:dev` (`STATIC_DIR=out`) if a local backend is available; real-messenger previews require production and are a manual post-deploy check (record the result in `docs/agents/place-links.md`).

## Out of scope

- Per-place previews for the address-bar URL `/?place=…` itself (only the share link `/place/…` has OG tags).
- URLs/share for ordered stories (`?job=`), walk parts, the tapped-house `PlaceSheet`, walks.
- Restoring cards without a URL by Back/Forward; changing `document.title` per place; SEO pages, sitemaps or `robots.txt` changes.
- Share analytics events, short-link services, QR codes.
- Changing the Metrika integration.

---
**Maintenance note (for the implementing agent):** when this plan is implemented, update the `Status:` line above, e.g. `Status: implemented YYYY-MM-DD in branch `feat/<name>``. If the plan changes during implementation, update the affected sections too — the plan must not lie about what was built.
