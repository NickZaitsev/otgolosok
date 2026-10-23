# Plan: Flutter mobile app (Android first) with screen-off walks and a live walk card

Status: implemented 2026-10-23 in branch `feat/promo-walks-stories-only`. Caveats: Steps 0, 9 and 10 were not done (they need real phones and store accounts); the app was verified on an Android 37 emulator only. See «As built» below.

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.

## As built (divergences from the steps below)

- **Step 0** was skipped at the user's request («всё подряд без гейта»); the screen-off checks remain open in `docs/agents/mobile-flutter.md` («Что не проверено»). **Steps 9 and 10** were not done.
- **Step 2:** the map style keeps the site's glyph host (versatiles) instead of the configured origin. The pixel ratio of the exported map icons on a real phone is unverified.
- **Step 3:** besides the exported site `translations.json`, the app's own UI strings live in per-area dictionaries (`assets/i18n/app/*.json`). `?lang=` is added only to requests marked `localized` (content endpoints, as on the site), not to every request.
- **Step 4:** `startSession` is an `@async` Pigeon method.
- **Step 5:** the walk screen is a light island in the app theme, not the site's dark listening screen. The route map shows the leg to walk now, highlighted, with the rest dimmed. It frames that leg once with the walker's first fix and, before the start, the start, the first leg and the first stop (`route-legs.ts` port in `lib/walk_engine/route_legs.dart`). It has no direction chevrons and no «Поесть рядом» layer. Taps on the car walk map do nothing, as on the site.
- **Step 6:**
  - The nav item is «Тренды», not «История».
  - Explore has no food or parking layers, no house lookup or story generation, no «Создать прогулку отсюда» and no video.
  - Places have no favourites (the site has none either). The map draws its own blue user dot.
  - Offline packs have no food source.
  - The legal links leave out the analytics and cookie documents.
  - The builder adds «Сохранить в личном кабинете» and has no food layer.
  - «Мои прогулки» reuses the library view.
  - The review form only sends reviews; there is no delete.
- All services are overridden in one root `ProviderContainer` (`lib/app/app_container.dart`). A child container resolved unoverridden providers in the root and crashed the app on start.

## Context

Otgolosok is a location-triggered audio guide: the walker keeps the phone in a pocket and the next story starts when GPS reaches the next stop (`PRODUCT.md`). Today it ships as:

- a PWA (static Next.js export in `src/`, Node backend `backend/server.mjs` behind `/api/`) at https://otgolosok.online. In a browser the walk works only with the screen on: the walk screen holds a wake lock (`src/lib/wake-lock.ts`, created in `src/features/tour/tour-experience.tsx:261`);
- an Android Capacitor 8 shell in `mobile/` that loads the production site (`docs/agents/mobile-app.md`, plan `docs/agents/plans/2026-10-05-mobile-store-apps.md`). Its Stage 2 (screen-off walk) was never built. **This plan does not touch the Capacitor project**; it stays as it is.

The owner decided to build a **new native Flutter client** with near-full feature parity with the site, Android first, and asked for two things to be worked out in depth: (1) geolocation so the walk keeps playing and advancing with the screen locked, and (2) a live "broadcast" card of the walk on the lock screen.

Why the screen-off part needs native Android code even in Flutter (verified 2026-10-23):

- Android 12+ forbids starting a foreground service (FGS) from the background; Android 14+ throws `SecurityException` when a `location` FGS is started while no activity is visible. https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Location from an FGS that was started while the app was visible counts as foreground location: no `ACCESS_BACKGROUND_LOCATION` needed. The Geofencing API, however, requires background location, so zone checks must be done in-app on FGS fixes. https://developer.android.com/develop/sensors-and-location/location/permissions
- Media3 keeps a `MediaSessionService` in the foreground for only ~10 minutes after playback pauses (RELEASENOTES of androidx/media). A walk leg between two stops can be longer, so the service must hold the foreground state itself for the whole walk. `audio_service` has an open crash for the same restriction (ryanheise/audio_service#996).
- Android 16 Live Updates: allowed styles are Standard, BigText, Call, Progress, Metric; requires `POST_PROMOTED_NOTIFICATIONS`, `setRequestPromotedOngoing(true)`, ongoing, a title, no custom views, not colorized. **MediaStyle cannot be promoted**, so the media player card and the Live Update are two notifications. https://developer.android.com/develop/ui/views/notifications/live-update — Samsung One UI 8 shows Live Updates and Media3 sessions in the Now Bar (third-party Live Updates may still need a developer option there; verify on a device).
- Flutter advantage over the WebView shell: Dart runs in the app process, so the walk logic keeps running while the FGS keeps the process alive (no WebView bridge throttling — cf. ionic-team/capacitor#6234).

Tooling at plan time: Flutter 3.47.7 stable (Dart 3.13.5). Candidate packages (verify current versions; pin exact versions, like the root `package.json` does): `maplibre_gl` 0.27.1 (MapLibre org, pre-1.0), `dio`, `cookie_jar`, `flutter_secure_storage`, `flutter_web_auth_2`, `go_router`, `flutter_riverpod`, `pigeon`. Rejected: `geolocator` FGS mode and `audio_service` (two separate notifications, foreground-start crashes), Transistorsoft `flutter_background_geolocation` (paid: $399, payment from Russia uncertain).

Costs: no paid APIs. Google Play one-time $25 (account may already exist, see the Capacitor plan step 1.0), RuStore free. Google's Android developer verification goes global in 2027 and will also cover RuStore installs on certified devices — check before release.

## Approved decisions

1. **Flutter, a new native client** (not a WebView wrapper). Android now; iOS later. The platform layer is designed so iOS is a Swift implementation of the same Pigeon API plus a Live Activity extension (see "iOS backlog"); no iOS code in this plan.
2. **Scope: parity with the site except the admin panel** (`src/features/admin`, `/api/story-admin/*`): explore map with stories and nearby walks, place cards and story audio, walk catalogue/top/trends, walk screen and player, offline walk copies, reviews and improvement requests, place feedback, favourites, walk builder (walking and car, food, parking, research and story jobs), car walks, account (rename, delete, my walks, sharing), sign-in/sign-up, legal documents, language switch. Planner default (confirm with the user if it matters): the classic bundled tour on `/` (`public/data/routes/paveletskaya.json`) is **not** ported — the site plans to retire it (`docs/agents/plans/2026-10-06-retire-builtin-catalog-tour.md`).
3. **Capacitor stays untouched** (`mobile/`, `capacitor.config.ts`, Capacitor dependencies, `docs/agents/mobile-app.md`, the 2026-10-05 plan). The Flutter project lives in **`mobile-flutter/`** at the repo root. Release `applicationId` is the same **`online.otgolosok.app`**; debug builds use `applicationIdSuffix ".dev"` so they install next to the Capacitor app. Shipping the Flutter app to a store under this id replaces the Capacitor app there — both cannot be published.
4. **Auth = the app is a first-party client of the site origin.** Session cookie (`__Host-otgolosok-session`) in a persistent cookie jar encrypted with Android Keystore; every request sends `Origin: https://otgolosok.online`; writes send `X-CSRF-Token` from `GET /api/auth/session`. Email sign-in/sign-up need no backend change. **Telegram** sign-in runs in the system browser (Custom Tab) and comes back with a one-time code bound to a PKCE challenge, which the app exchanges for its own session (two new backend endpoints + a static site page, Step 7). No bearer-token auth.
5. **UI languages ru/en/zh**, strings generated from the site dictionaries (Russian source strings stay the keys, same `{placeholder}` syntax). Content language follows the UI language, as on the site.
6. **minSdk 26** (Android 8.0); compile/target SDK 36 (same as `mobile/android/variables.gradle`; re-check Google Play's target API requirement at release).
7. **Default advance mode in the app is `place`** («По месту»); `manual` and `sequence` stay in the walk settings. The site default (`manual`, `src/features/tour/walk-settings.ts:32`) is not changed.
8. **Screen-off walk: own Kotlin foreground service** (`foregroundServiceType="location|mediaPlayback"`) with FusedLocationProvider (fallback to platform `LocationManager` when Google Play services are missing — RuStore devices), Media3 ExoPlayer + MediaSession, started from the visible «Начать прогулку» tap and kept in the foreground until the walk ends. The walk logic (trigger, stages, advance modes, checkpoints) lives in **Dart**. No `ACCESS_BACKGROUND_LOCATION`, no third-party background-location or audio-service packages.
9. **Live card:** a Media3 media notification for the whole walk (lock screen, shade, headset, Samsung Now Bar) **plus, on Android 16+ (API 36), a promoted Live Update** (ProgressStyle with one segment per stop, status-bar chip with the distance) while the walker is heading to the next stop and no story is playing. Below API 36 the distance goes into the media notification's subtitle.
10. **Swiping the app away from Recents does not stop the walk**: the FlutterEngine is owned by the `Application` (`FlutterEngineCache`), the service has `stopWithTask="false"`; the notification has a «Стоп» action.
11. **No analytics SDK in v1** (AppMetrica can be proposed later; the backend already counts walk launches).
12. Stores: Google Play and RuStore, after the field test (Step 9).

Planner defaults (may be changed if the user objects): Riverpod for state, `go_router` for navigation, `dio` for HTTP, Pigeon for the platform API, hand-written `fromJson` validators that fail closed (no codegen requirement), `shared_preferences` for settings, files + JSON manifests (no database) for offline copies.

## Key codebase facts

Size and layout

- Site client: ~19.9k lines of non-test TS/TSX and ~7.3k lines of CSS in `src/`, 148 test files. Feature folders in `src/features/` (largest: `tour` 3.5k, `explore` 3.4k, `admin` 2.9k, `walks` 2.3k, `walk-builder` 1k lines).
- Pages: `src/app/(ru)/{page,walk,history,trends,account,account/walks,login,legal/[document],admin}`; `src/app/[locale]/` mirrors the public pages for `en` and `zh` (no admin, no legal).
- Bottom navigation labels (dictionary `src/lib/i18n/dictionaries/core.ts`): «Рядом», «Прогулка», «История», «Профиль».

Tooling constraints

- `pnpm check` = lint + typecheck + `vitest run` + `node --test backend/*.test.mjs` + Python checks + build (`package.json`). The standard production deploy re-runs the full check (`docs/agents/geolocation.md`, «Выкладка 8 октября»; the deploy target lives outside this repo), so Flutter commands must never be added to `pnpm check` — the site must stay checkable and deployable without the Flutter SDK.
- `vitest.config.ts:9` includes `src/**/*.test.ts` and `mobile/*.test.ts`. `eslint.config.mjs` has a `globalIgnores([...])` list (add `mobile-flutter/**`).
- Runtime dependencies are pinned to exact versions; follow that in `pubspec.yaml`.
- Release signing of the Capacitor app reads `mobile/android/keystore.properties` or `OTGOLOSOK_KEYSTORE_FILE`, `OTGOLOSOK_KEYSTORE_PASSWORD`, `OTGOLOSOK_KEY_ALIAS`, `OTGOLOSOK_KEY_PASSWORD` and fails without them (`docs/agents/mobile-app.md`, «Подпись релиза»). The same upload key must sign the Flutter release.
- Capacitor App Links filter: `https://otgolosok.online` with paths `/`, `/walk`, `/place/…` (`mobile/android/app/src/main/AndroidManifest.xml`); `/.well-known/assetlinks.json` does not exist yet (needs fingerprints).

Backend contract (S = `backend/server.mjs`)

- Errors: `{error:{code,message}}`; JSON bodies need `Content-Type: application/json`, top-level object, small size limits (S:83-89).
- `GET /api/auth/session` → `{user|null, csrfToken|null}`; the CSRF token is an HMAC of the session id (S:205).
- Gate for `/api/me*` (S:208-211): no session → 401; a present-but-different `Origin` or `sec-fetch-site: cross-site` → 403; every non-GET needs `X-CSRF-Token`.
- Gate for anonymous POSTs such as `/api/walk-plan`, `/api/story-walks/resolve`, launches (S:835-836): `Origin` must equal the site origin, `sec-fetch-site` absent/`same-origin`/`none`. These are CSRF defences, not abuse protection — a native client sending the site `Origin` does not weaken them.
- Public feedback writes (reviews, improvements, place feedback) need the matching `Origin`, CSRF when signed in, otherwise the guest header `X-Review-Key` (43 base64url chars; site keeps it in `localStorage otgolosok:review-key:v1`, `src/features/reviews/device.ts`).
- Better Auth (`backend/auth.mjs`): email/password 10–128 chars; Telegram via a custom OIDC plugin (`backend/telegram-auth.mjs`, issuer `https://oauth.telegram.org`, PKCE + nonce); `/sign-in/social` is rejected unless `Origin` equals the site origin (auth.mjs:35); sign-up requires `termsAccepted: true` and `termsVersion === TERMS_VERSION` (auth.mjs:46-50; `TERMS_VERSION` = `"2026-10-08"` in `legal/publication.mjs`, `LEGAL_READY` from `legal/publication.json`). The session `create` hook sets `authProvider` to `"telegram"` only when the path is the Telegram callback, otherwise `"password"` (auth.mjs, `session.create.before`); deleting a Telegram account requires a session younger than 5 minutes (`freshTelegramSession`). Cookie: HttpOnly, Secure, `SameSite=Lax`, path `/`; session 7 days, renewed daily, 30-day cap.
- Web Telegram flow: `src/features/auth/client.ts:55-71` POSTs `/api/auth/sign-in/social` with `disableRedirect: true`, checks the returned URL is `https://oauth.telegram.org/auth`, then `location.replace(url)`; the callback sets the cookie in the browser and redirects to a same-origin `callbackURL` (`src/features/auth/return-to.ts`).
- Endpoints the app needs (validators to port in brackets): `GET /api/story-walks`, `GET /api/story-walks/{slug}/view?lang` (410 `WALK_MOVED` with `share`), `GET /api/story-walks/shared/{uuid}?lang`, `POST /api/story-walks/resolve?lang` [`validateWalkView`, `src/features/walks/model.ts`]; `GET /api/top-walks` [`validateTopWalkPage`, `src/features/walks/top-model.ts`]; `GET /api/walks/nearby?lat&lon` [`src/features/walks/nearby-model.ts`]; `GET /api/walks/map?west&south&east&north` [`src/features/explore/walk-overview.ts`]; `POST …/launches`; reviews and improvements under `…/reviews`, `…/improvements/mine`; `GET /api/content/map-cells` and `/api/content/map-cells/{lat}/{lon}` (ETag + `If-None-Match`, `src/lib/geo/cell-store.ts`); `GET /api/content/places/{osmId}?lang` [`src/features/explore/place-story.ts`]; `…/feedback/mine`; `GET /api/story-place?q|lat&lon` (one request per 1.1 s globally, 429 `PLACE_BUSY`); `POST /api/walk-plan` (one plan at a time, ≥2 s apart, 429 `WALK_RATE_LIMITED`/`WALK_BUSY`) [`src/features/walk-builder/model.ts`]; `/api/walk-research-jobs*`, `/api/story-jobs*` (daily quota 6); `/api/food/cells*`, `/api/parking/*`; `/api/me`, `/api/me/walks*`, `/api/me/favorites/*`, `/api/me/requests`, `PUT /api/me/walks/{id}/sharing`. Locale: `?lang=en|zh` only when not `ru` (`src/features/walks/walk-loader.ts:97-105`); a response in the wrong locale is rejected by the client.
- Media: audio `/api/story-audio/<sha256>.mp3` (immutable, Range supported), images `/api/place-images/<sha256>.jpg`, `/images/places/<slug>.jpg`, Flickr URLs.
- Client retry policy to mirror (`loadJson`, `walk-loader.ts:42-95`): 3 attempts, 20 s timeout, retry on network/429/5xx with 500·2ⁿ ms backoff or `Retry-After`, capped at 5 s; a `Retry-After` above 5 s fails at once. Requests that are retried must be idempotent.

Walk logic to port (TS is the reference)

- `src/lib/geo/trigger.ts`: `DEFAULT_TRIGGER_CONFIG` = enter 35 m, exit 60 m, `minFixes` 3, `windowSize` 5, `maxAccuracyM` 50; `processFix(state, fix, target, config, audioBusy)` ignores invalid or too inaccurate fixes, fires `entered` when the window is full, ≥`minFixes` inside, the current fix inside and no audio playing; `inside` → `exited` beyond `exitM` → `cooldown` until reset. `src/lib/geo/distance.ts`: haversine, Earth radius 6 371 000 m.
- `src/features/tour/walk-plan.tsx`: `arrivalTarget` (approach → this chapter's `trigger_location ?? location`; stop → next chapter or finish), `arrivalTriggerConfig`, `highlightedLeg`, `hasFinishLeg` (finish farther than the last stop's `enter_m`), `getWalkChapters(route, includePending)`, `followChapter` (keeps the walker's stop when stops are inserted).
- `src/features/tour/tour-experience.tsx`: `startTour` (:230-284: start index from `fromStop`, else checkpoint, else 0; universal walk + non-sequence + position < 1 s → stage `approach`, else `stop`; report launch; start GPS), `stopTour` (:286), `showStop` (:305, resets the trigger and retargets), `selectChapter` (:318), `arriveByPlace` (:346; only in `place` mode), sequence auto-advance when a track ends (:189-192), lock-screen actions (:211-228).
- `src/features/tour/use-walk-position.ts`: position sources `browser` / `replay` (`?replay=clean|walk&speed=1..20`); trigger reset on retarget; status texts such as «Нет доступа к геолокации · звук доступен по кнопке».
- `src/features/tour/use-walk-audio.ts`, `src/lib/audio/playback-progress.ts`: checkpoint `{version:1, routeId, chapterId, audioUrl, positionSec}` saved after ≥2 s of progress, on pause and when hidden; valid only when chapter and URL match.
- `src/features/tour/walk-settings.ts`: modes `manual|place|sequence`, rates 0.8/1/1.25/1.5.
- Car walks: `src/features/tour/driving-plan.ts` (phases overview → driving → visiting → returning → … → complete; GPS never starts a story), `driving-experience.tsx`.
- `src/lib/position/locate.ts` (one-shot «где я»: coarse fix first, refine up to 6 s or 30 m accuracy, 20 s timeout counted after permission; `docs/agents/geolocation.md`); `src/features/explore/nearby-stories.ts` (radius 100/200/300 m by accuracy, top 3).
- Offline copies (`src/features/walks/offline.ts`): ≤60 MB per pack, scopes user id / `public:catalog` / `public:shared` / `device:local`, manifest `{walkId, scope, requestedLocale, revision, contentVersion, savedAt, audio[{chapterId,url,sha256,bytes}], food?}`, staged write with sha256 checks and an atomic pointer; used only after network error, 5xx, 408 or 429; account scopes deleted on sign-out.

Shared assets to generate from the site

- i18n: `src/lib/i18n/translate.ts` merges five dictionaries (`src/lib/i18n/dictionaries/{core,explore,walks,account,driving}.ts`) of shape `{ "<ru source>": [en, zh] }`; placeholders `{name}`; `dictionary-completeness.test.ts` exists.
- Map: `src/features/explore/map-style.ts` exports `mapStyle` (:92) built in code; tiles `https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}` (Shortbread, max zoom 14); glyphs `/assets/glyphs/{fontstack}/{range}.pbf` on the site; no sprite — icons are drawn at runtime by `map-icons.ts`.
- Design tokens: `src/styles/tokens.css` is the source of truth (DESIGN.md mentions Manrope/Cormorant and a non-existent `globals.css` — outdated). Brand background `#eee9df`, theme `#b52d20`; controls ≥48 px; dark listening screen palette «Прогулка».
- Legal documents are rendered by the site (`src/features/legal/documents.tsx`, `src/lib/legal/document-content`); there is no API exposing `TERMS_VERSION`/`LEGAL_READY`.

## Implementation

Documentation produced by the implementing agent (`docs/agents/mobile-flutter.md`, README section) is written in Russian (AGENTS.md). Commit after each step (Conventional Commits, Russian description, e.g. `feat(mobile-flutter): …`).

### 0. Feasibility gate on a real Android phone (before any feature work)

Build Steps 1, 4 and the minimal part of 3 (trigger + a two-stop hardcoded walk with local test MP3s), then on a real phone (and Android 16 if available, plus a Samsung One UI 8 device if available) verify and record in `docs/agents/mobile-flutter.md` (device, Android version, Play services yes/no):

1. Fixes keep arriving in Dart with the screen locked for ≥60 minutes of walking; trigger fires; a new track starts from the background after ≥15 minutes of silence (beyond the Media3 10-minute idle rule).
2. Swipe-away from Recents: walk continues; reopening the app shows the running walk.
3. Lock-screen media controls (play/pause/next/previous/«Стоп») and headset buttons reach Dart.
4. Android 16: the Live Update appears (shade top, lock screen, status-bar chip) and disappears while a story plays.
5. Battery drain over 60 minutes; behaviour under Doze and an OEM battery saver.

If 1 or 2 fails without a clean fix: **stop and report to the user** with options before building features.

### 1. Scaffold `mobile-flutter/`

- `flutter create --org online.otgolosok --project-name otgolosok --platforms android mobile-flutter` (verify flags against the installed Flutter). Package id must end up `online.otgolosok.app`; `minSdk 26`, `compileSdk`/`targetSdk 36`; debug `applicationIdSuffix ".dev"`, app label «Отголосок (dev)» for debug.
- Layout:
  - `lib/app/` — app root, router (`go_router`), theme (`tokens.g.dart` generated, see Step 2), localization delegate.
  - `lib/core/` — `api/` (client, errors, retry), `auth/`, `i18n/`, `storage/`, `location/` (one-shot locate), `links/` (App Links → routes).
  - `lib/walk_engine/` — pure Dart, no Flutter imports: trigger, distance, walk plan, session state machine, driving reducer, checkpoints.
  - `lib/features/<feature>/` — `explore`, `places`, `walks` (library, top, trends, walk screen), `player`, `offline`, `walk_builder`, `driving`, `account`, `auth`, `reviews`, `feedback`, `legal`, `settings`.
  - `packages/walk_service/` — local Flutter plugin: Pigeon definition `pigeons/walk_service_api.dart`, generated Dart/Kotlin (committed), Android implementation in Kotlin. iOS later adds Swift to the same package.
  - `test/`, `integration_test/`, `test/fixtures/` (generated from the site, Step 2).
- `analysis_options.yaml`: `flutter_lints` plus `strict-casts`, `strict-inference`, `strict-raw-types`.
- Release signing in `android/app/build.gradle(.kts)`: read `mobile-flutter/android/key.properties` (gitignored) or the same `OTGOLOSOK_KEYSTORE_*` / `OTGOLOSOK_KEY_*` env vars as Capacitor; fail `assembleRelease`/`bundleRelease` with a clear message when missing. JDK 21 (see `docs/agents/mobile-app.md` for the JDK 25 issue; verify with the Flutter Gradle template).
- Launcher icons and splash from `src/app/icon.svg`: extend `scripts/build-app-icons.mjs` with a separate output set for `mobile-flutter/android/app/src/main/res` (keep Capacitor outputs byte-identical).
- Root `package.json` scripts (not part of `check`): `"mobile-flutter:check": "cd mobile-flutter && flutter analyze && flutter test"`, `"mobile-flutter:run": "cd mobile-flutter && flutter run"`.
- Root `.gitignore`: `mobile-flutter/build/`, `mobile-flutter/.dart_tool/`, `mobile-flutter/.flutter-plugins*`, `mobile-flutter/android/.gradle/`, `mobile-flutter/android/local.properties`, `mobile-flutter/android/key.properties`, `mobile-flutter/**/.idea/` and other files `flutter create` lists in its own `.gitignore` (keep that file too). `eslint.config.mjs` `globalIgnores`: add `mobile-flutter/**`.
- API origin: `--dart-define=OTGOLOSOK_API_ORIGIN` (default `https://otgolosok.online`); non-https only with `--dart-define=OTGOLOSOK_DEV=1` (mirror `mobile/capacitor-config.ts` rules). The `Origin` header always equals the configured origin.

### 2. Generated shared assets (site → app), as Vitest file snapshots

Use Vitest's `expect(value).toMatchFileSnapshot(path)` so the files are produced from the real TS modules and `pnpm check` fails when the site changes without regenerating them (`pnpm vitest run -u <test>` regenerates). Place the tests next to their sources:

- `src/lib/i18n/mobile-export.test.ts` → `mobile-flutter/assets/i18n/translations.json` (`{ "<ru>": ["<en>", "<zh>"] }` from `translations`, keys sorted).
- `src/features/explore/map-style.mobile-export.test.ts` → `mobile-flutter/assets/map/style.json` (`mapStyle` with the glyphs URL made absolute on the configured origin; fail if the style references a sprite or a non-allowlisted host).
- `src/styles/tokens.mobile-export.test.ts` → `mobile-flutter/lib/app/theme/tokens.g.dart` (Dart constants for colours, type scale, spacing, radii, control sizes parsed from `:root` of `tokens.css`; header comment «generated, do not edit»).
- `src/lib/geo/trigger.mobile-export.test.ts`, `src/features/tour/walk-plan.mobile-export.test.ts`, `src/features/tour/driving-plan.mobile-export.test.ts`, `src/lib/audio/playback-progress.mobile-export.test.ts`, `src/features/explore/nearby-stories.mobile-export.test.ts` → `mobile-flutter/test/fixtures/engine/*.json`: deterministic scenario inputs (table-driven: boundaries 34.9/35/35.1 m, accuracy 50/50.1 m, window not full, busy audio, cooldown, invalid coordinates, finish leg on/off, inserted stops for `followChapter`, every driving action from every phase, checkpoint mismatch) and the outputs computed by the TS functions. Dart tests replay the same inputs against the port and must produce identical outputs.
- `src/features/walks/model.mobile-export.test.ts` (and similar for top/nearby/place/walk-builder models) → `mobile-flutter/test/fixtures/api/*.json`: valid documents and invalid ones (each annotated with the expected verdict from the TS validator) taken from the existing site test fixtures, so both validators agree.
- Map icons: `map-icons.ts` draws on a canvas; add a Playwright-based exporter to `scripts/build-app-icons.mjs` (it already rasterizes via Chromium) that renders each icon id at 1x/2x/3x into `mobile-flutter/assets/map/icons/`. Regenerated manually; documented in `docs/agents/mobile-flutter.md`.

### 3. Dart core (`lib/core/`)

- `ApiClient` (dio): base URL = configured origin; interceptors in order: `Origin`; `lang` query when the UI locale is not `ru`; `X-CSRF-Token` on non-GET when a session exists; `X-Review-Key` for guest feedback endpoints only; 20 s timeout; retry exactly like `loadJson` (only for GET and requests the site already treats as idempotent — PUT/DELETE, POSTs with `idempotencyKey`). Typed `ApiError {status, code, message, retryable, retryAfter, movedToShare}`. Invalid JSON or a failed validator → `ApiError.corrupt`. A logging interceptor (debug only) redacts `Cookie`, `Set-Cookie`, `X-CSRF-Token`, `X-Review-Key`, auth codes.
- Cookie storage: `cookie_jar` `PersistCookieJar` with a storage adapter on `flutter_secure_storage` (Keystore-encrypted). On 401 from `/api/me*` clear the session state and show the sign-in entry, never loop.
- CSRF: fetched from `GET /api/auth/session` after sign-in, app start and on 403 `CSRF` (one refresh + one retry, then surface the error).
- Guest review key: 43-char base64url random, generated once, stored in secure storage.
- i18n: `t(context, '<русская строка>', {values})` reading `assets/i18n/translations.json`, same fallback (missing entry → Russian source) and placeholder regex as `translate()`. Locale: stored choice, else device locale (`ru`/`uk`/`be`/`kk` → ru, `zh*` → zh, otherwise en). Changing language during a walk asks the same confirmation as the site («Смена языка прервёт прогулку. Продолжить?»).
- Theme: `ThemeExtension` built from `tokens.g.dart`; light «Читальня» and dark listening screen; system fonts (Georgia/Arial are not on Android: use the platform serif/sans fallbacks); minimum control height 48 dp.
- Settings in `shared_preferences`: walk settings `{advance: place (default), rate}`, locale, walk direction per route, checkpoints per route+locale(+reverse).

### 4. Native walk service (`packages/walk_service/`, Kotlin)

Pigeon API (`pigeons/walk_service_api.dart`):

- Host (Dart → native): `startSession(SessionConfig)` where `SessionConfig {kind: walk|listen, walkTitle, notificationTexts (localized), tracking: bool, locationIntervalMs (default 1000), minDistanceM (default 0)}`; `stopSession()`; `isSessionActive()` (for UI restore); `play(Track {id, uri, title, subtitle, album, artworkUri?, startPositionMs, rate})`; `pause()`; `resume()`; `seekTo(ms)`; `seekBy(ms)`; `setRate(rate)`; `prefetch(uri)`; `updateCard(CardState {stage: approach|playing|paused|finished, chapterIndex, chapterCount, chapterTitle, nextStopTitle?, distanceM?})`; `permissionState()`; `requestPermissions()` (fine location, then POST_NOTIFICATIONS on 33+); `openAppSettings()`.
- Flutter (native → Dart): `onFix(Fix {lat, lon, accuracyM, timestampMs, provider})`, `onLocationStatus(status: active|unavailable|permission_denied|error, code?)`, `onPlayer(PlayerState {trackId, state: idle|buffering|playing|paused|ended|error, positionMs, durationMs, errorCode?})`, `onMediaCommand(play|pause|next|previous|seekBy(ms)|seekTo(ms)|stop)`.
- Errors are `FlutterError(code, message)` with codes `fgs_not_allowed`, `permission_denied`, `location_unavailable`, `player_error`, `invalid_argument`; Dart maps them to user-facing Russian texts with retry.

Service `WalkService : MediaSessionService` (Media3 `media3-session` + `media3-exoplayer`, verify current versions):

- Manifest: `android:foregroundServiceType="location|mediaPlayback"`, `android:stopWithTask="false"`, exported with the `androidx.media3.session.MediaSessionService` intent filter as Media3 requires. Permissions: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `POST_NOTIFICATIONS`, `POST_PROMOTED_NOTIFICATIONS`, `WAKE_LOCK`. **Not** `ACCESS_BACKGROUND_LOCATION`.
- Start: only from `startSession` called inside the visible activity's tap; `ContextCompat.startForegroundService` then `startForeground` within 5 s with type `LOCATION|MEDIA_PLAYBACK` (`MEDIA_PLAYBACK` only for `kind=listen`). Catch `ForegroundServiceStartNotAllowedException`/`SecurityException` → `fgs_not_allowed`.
- Foreground for the whole session regardless of playback state: override Media3's notification/foreground handling (e.g. `onUpdateNotification(session, startInForegroundRequired = true)` or an equivalent supported hook — verify in the installed Media3) so the 10-minute idle demotion never applies while `tracking` is on. `stopSession` → `stopForeground(STOP_FOREGROUND_REMOVE)` + `stopSelf()`; `START_NOT_STICKY` (after a system kill the user resumes from the checkpoint).
- Location: `LocationSource` interface with `FusedLocationSource` (`PRIORITY_HIGH_ACCURACY`, interval 1 s, min interval 1 s, `setWaitForAccurateLocation(false)`) when `GoogleApiAvailability` reports success, else `PlatformLocationSource` (`LocationManager` GPS + network providers). Fixes are posted to Dart on the main looper. Permission revoked mid-walk → `permission_denied`, the walk continues in manual mode.
- Player: single-item ExoPlayer; `AudioAttributes(USAGE_MEDIA, AUDIO_CONTENT_TYPE_SPEECH)`, `handleAudioFocus = true`, `setHandleAudioBecomingNoisy(true)`, `setWakeMode(C.WAKE_MODE_NETWORK)`. `CacheDataSource` over a `SimpleCache` (LRU, 200 MB, app cache dir) for streamed audio; offline packs play `file://` URIs. `prefetch(uri)` writes the next chapter into the cache (`CacheWriter`, cancelled on stop). Network errors: Media3's load error policy with a bounded retry count (3), then `onPlayer(error)`.
- Media session: a `ForwardingPlayer` advertises previous/next commands and forwards next/previous/stop to Dart via `onMediaCommand` (Dart decides what "next" means, as `selectChapter` does on the site). Custom layout buttons: back 15 s, play/pause, «Дальше», «Стоп». Metadata: title = chapter title, artist = «Часть N из M», album = walk title, artwork = place photo or app icon. Content intent opens the walk screen.
- Live Update (API 36+ only, `Build.VERSION.SDK_INT >= 36` guard): separate channel «Путь к точке» (default importance, not min); `Notification.Builder` (platform API; use `NotificationCompat` only if it supports ProgressStyle/promotion at implementation time) with `ProgressStyle` (one segment per stop, progress = stops passed), `setRequestPromotedOngoing(true)`, `setOngoing(true)`, title «До «<stop>»», text «Часть N из M», `setShortCriticalText("<distance> м")`. Shown when `CardState.stage == approach`, cancelled while `playing`/`paused`/`finished`. Update only when the rounded distance changes by ≥10 m and at most every 5 s. If `NotificationManager.canPostPromotedNotifications()` is false, post nothing extra (media card remains).
- Below API 36: during `approach`, the media notification subtitle shows «До «<stop>» · <distance> м».
- Engine lifetime: a custom `Application` creates the `FlutterEngine`, runs the Dart entrypoint once and puts it into `FlutterEngineCache`; `MainActivity` attaches to the cached engine. Plugin registration must work without an activity (permissions only when one is attached).

### 5. Walk engine and player (`lib/walk_engine/`, `lib/features/player/`)

- Ports (must pass Step 2 fixtures): `distance.dart`, `trigger.dart`, `walk_plan.dart` (all functions listed in Key facts), `checkpoint.dart`, `driving_plan.dart`, `nearby_stories.dart`.
- `WalkSession` (pure Dart state machine) implementing the `tour-experience.tsx` behaviour contract: `start({resume, fromStop})`, `selectChapter(i)`, `next()`/`previous()`, `onFix(fix)` (runs `processFix` with `busy = audio playing`), `onTrackEnded()` (sequence auto-advance; finish leg handling), `play()`/`pause()`, `stop({completed})`. Outputs: `PlayerCommand` stream (play/pause/seek/prefetch), `CardState`, UI state (chapter, stage, distance, status text keys identical to `use-walk-position.ts` `getStatusText`). Checkpoints saved after ≥2 s of progress, on pause, on stop, on `AppLifecycleState.paused`. Launch reported once per walk start (`POST …/launches`, fire-and-forget with the API retry policy, errors logged in debug only).
- Position sources: `NativePositionSource` (walk service) and `ReplayPositionSource` (port of `createWalkReplayTrack`, `CLEAN_REPLAY_TRACK`) enabled only in debug builds through a hidden diagnostics panel (site `?replay` / `?debug=1` equivalent).
- Permission UX before the first walk: explain in Russian why location is used with the screen off; request fine location, then notifications (33+). Denied location → the walk runs in `manual` mode with «Нет доступа к геолокации · звук доступен по кнопке»; denied notifications → the walk still runs, with a hint that lock-screen controls are hidden. Never a dead end.
- The dark listening screen mirrors the site (`classic-walk-view.tsx`, `walk-session.tsx`): current stop, stage, distance, signal tone, audio controls, rate, advance mode switch with the «По месту» warning when geolocation is unavailable, sources/facts of the story, historical photos.

### 6. Feature screens (parity), each with its endpoints from Key facts

1. Shell: bottom navigation «Рядом», «Прогулка», «История», «Профиль»; `go_router` routes mirroring site URLs; App Links for `/`, `/walk`, `/place/<type>/<id>` (same paths as the Capacitor manifest) mapped like `src/features/native/app-links.ts` (`/place/…` → place card on the map); if a walk is running, ask «Прервать прогулку и открыть ссылку?».
2. Explore map: MapLibre with `assets/map/style.json` and exported icons; map cells with on-disk ETag cache (revalidate after 5 min, ≤4 parallel fetches, as `cell-store.ts`); clustering visually equivalent to `map-clusters.ts` (port the algorithm or use a GeoJSON cluster source — compare screenshots); «Моё местоположение» with the `locate.ts` semantics (coarse then refine, 6 s window, 20 s timeout after permission) and the three-state locate icon; nearby stories; nearby walks; walks overview on the map.
3. Place card and story: text, facts and sources (no third-party sources inside narrated text — content is shown as served), photo with attribution, story audio through the walk service in `kind=listen`, share via the Android share sheet using `placeShareUrl` semantics, favourite, place feedback.
4. Walk library («История»), top walks with filters (duration buckets, city), trends, my walks; walk card actions (open, share link copy, visibility).
5. Walk screen: load by catalogue slug / share token / account id / local walk; 410 `WALK_MOVED` → open the share; offline copy notice; reviews and improvement requests; reverse direction before start; start from a stop; route map with highlighted leg (see «As built»); car-copy action where the site offers it.
6. Offline copies: port `offline.ts` semantics into app files dir (`walk-packs/<scope>/<walkId>[/<locale>]/` with staging dir, sha256-verified audio, 60 MB budget, food data ≤4 MB, atomic pointer file, orphan cleanup); same fallback conditions; account scopes deleted on sign-out; the player prefers local files.
7. Walk builder: start point via map tap / «где я» / address search (`/api/story-place`, client-side throttle ≥1.1 s, 429 `PLACE_BUSY` shown as «Подождите секунду»); mode loop/open, 30/60/90 min walking or 60/120/180 car; destination and stops; food and parking layers; research jobs with consent and recovery token; story jobs (session required, quota 6/day); guest local walks stored in app storage (no import from the site's localStorage); save to account with `idempotencyKey`; sharing visibility.
8. Car walks: `driving_plan.dart` reducer + UI; audio only while visiting, via `kind=listen` (no GPS trigger, as on the site).
9. Account: profile, rename, delete (password, or Telegram re-auth within 5 minutes), favourites, requests, sign-out (clears cookie jar, CSRF, account offline scopes). Legal documents open the site pages `/legal/<document>` in a Custom Tab (single source of legal text).
10. Language switch in the profile.

### 7. Sign-in, sign-up and Telegram handoff

App side:

- Email sign-in/sign-up screens with the same validation and texts as `src/features/auth/login.tsx`; sign-up shows the terms checkbox and sends `termsVersion` from `GET /api/legal/publication` (below). `LEGAL_READY=false` → sign-up and Telegram sign-up disabled with the site's text.
- Telegram: generate `verifier` (32 random bytes, base64url) and `challenge = base64url(SHA-256(verifier))`; open `https://otgolosok.online/app-auth/telegram?challenge=…&terms=<version or empty>` with `flutter_web_auth_2` (Custom Tab, callback scheme `otgolosok-auth`); on `otgolosok-auth://telegram?code=…` call `POST /api/mobile-auth/exchange {code, verifier}`; on `?error=…` show the matching message (`TERMS_REQUIRED`, cancelled, generic). Verify the current `flutter_web_auth_2` Android setup (callback activity in the manifest).

Site/backend side (normal site rules apply: tests, `pnpm check`, Russian UI text):

- `GET /api/legal/publication` → `{ready: LEGAL_READY, termsVersion: TERMS_VERSION}` (no auth, cacheable for 5 minutes).
- Static page `src/app/(ru)/app-auth/telegram/page.tsx` (no navigation chrome, `noindex`): validates `challenge` (43 base64url chars), then runs the existing web Telegram start (`POST /api/auth/sign-in/social` from the browser, so the Origin hook at auth.mjs:35 passes) with `callbackURL=/app-auth/telegram/complete?challenge=…` and `errorCallbackURL=/app-auth/telegram/complete?challenge=…&failed=1` (both pass `safeReturnTo`).
- Static page `src/app/(ru)/app-auth/telegram/complete/page.tsx`: on success reads `csrfToken` from `/api/auth/session`, calls `POST /api/mobile-auth/handoff {challenge}` (gate M: session, Origin, CSRF), receives `{code}`, signs the browser session out (`POST /api/auth/sign-out`, best effort), then `location.replace("otgolosok-auth://telegram?code=…")`; on failure redirects to `otgolosok-auth://telegram?error=<code>`.
- New module `backend/mobile-auth.mjs` (+ `backend/mobile-auth.test.mjs`), wired in `server.mjs`:
  - Table `mobile_auth_handoff(id, code_hash, challenge, user_id, auth_provider, created_at, used_at)` in the account database (survives restarts).
  - `POST /api/mobile-auth/handoff`: requires a session; stores `sha256(code)`, the challenge, the user id and the browser session's `authProvider`; returns a 32-byte base64url `code`; TTL 60 s.
  - `POST /api/mobile-auth/exchange {code, verifier}`: anonymous; rate-limited (reuse `createReviewRateLimiter`, e.g. 20/min per `x-real-ip`); checks the hash, unused, unexpired, `base64url(sha256(verifier)) === challenge`; marks used atomically; creates a new Better Auth session for the user through Better Auth's internal adapter **with `authProvider` copied from the handoff** (the session `create` hook would otherwise label it `"password"` and break Telegram account deletion — handle explicitly and test); sets the session cookie with Better Auth's cookie helpers; returns `{user, csrfToken}`. All failures return the same 400 `HANDOFF_INVALID` (no oracle); codes, verifiers and cookies never appear in logs.
  - Expired rows are deleted on each write.

### 8. Documentation

- `docs/agents/mobile-flutter.md` (Russian): architecture (Dart engine + Kotlin service, why), how to build and run on Windows (Flutter, JDK 21, Android SDK, `adb` emulator geo fixes), debug `.dev` id, signing, generated assets and how to regenerate them, Live Update notes, Step 0 and Step 9 result tables, known OEM battery-saver issues with links for users. Add it to `docs/agents/README.md` with a two-sentence description.
- `README.md`: short Russian section «Мобильное приложение (Flutter)» with commands and the link.

### 9. Field verification

On real phones, recorded in `docs/agents/mobile-flutter.md`: a full ≥60-minute walk in Moscow with the screen locked in `place` mode (every stop triggered, no false triggers, finish leg), weak signal and an underground passage, a phone call interrupting playback (audio focus), headphones unplugged, offline copy in airplane mode, swipe-away mid-walk, Android 16 Live Update, Samsung Now Bar, a device without Google Play services (platform location fallback), battery numbers, sign-in by email and Telegram, App Links from a messenger.

### 10. Store release (Google Play, RuStore)

- Versioning: `versionName` semver from `1.0.0`, `versionCode` monotonically increasing; higher than any Capacitor build already uploaded under the same id (check the consoles).
- Google Play: AAB; Play Console foreground-service declarations for `location` (user-started walk that plays stories at places; video of a locked-screen walk) and `mediaPlayback`; Data safety (precise location used on device for triggers; coordinates sent to the server for nearby walks, address search and parking — verify what the backend logs before filling the form); privacy policy URL; closed-test requirement for new personal accounts (12 testers, 14 days) — see the 2026-10-05 plan.
- RuStore: signed APK with the same key; listing and privacy policy.
- The privacy policy text must mention location use with the screen locked during an active walk — the **user approves** legal text changes.
- `/.well-known/assetlinks.json` with all signing fingerprints (production nginx lives in the external `services` repo — hand the owner the exact change).

### iOS backlog (not implemented in this plan)

Swift implementation of the same Pigeon API in `packages/walk_service/ios/`: `CLLocationManager` with When-In-Use, `allowsBackgroundLocationUpdates`, `showsBackgroundLocationIndicator`; `UIBackgroundModes` `location` + `audio`; `AVAudioSession` `.playback` + `.spokenAudio`, activated at walk start and kept active for the whole walk (activating a non-mixable session from the background fails with `cannotInterruptOthers`); `AVPlayer`; `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`; Live Activity + Dynamic Island via an ActivityKit Widget Extension (SwiftUI), updated locally from the background (8 h active + 4 h on the Lock Screen, 4 KB data). Needs a Mac or cloud macOS CI (new infrastructure — explicit approval) and an Apple Developer account (payment from Russia is currently problematic).

## Testing & verification

- Dart unit tests (`flutter test`): engine ports against Step 2 fixtures; `WalkSession` table-driven scenarios (each advance mode × universal/approach/stop × finish leg × busy audio × manual next/previous × permission denied × resume from checkpoint × reverse direction); API client (retry/backoff/`Retry-After` > 5 s, 410 `WALK_MOVED`, corrupt JSON, CSRF refresh once, 401 handling, header redaction); validators against API fixtures (valid and invalid); offline pack manager (sha256 mismatch, budget overflow, interrupted staging, revision change, sign-out cleanup); i18n placeholders and fallback; Telegram PKCE helpers.
- Widget tests: player screen states (locked, approach with distance, playing, paused, GPS denied, finished), sign-up terms gating, map sheet states.
- Kotlin unit tests (JUnit, Robolectric where needed): Live Update builder (API 36 guard, segments, chip text, throttling), notification text below API 36, location source selection with/without Play services, error code mapping, foreground policy (never demoted while `tracking`).
- `integration_test` on an emulator: replay walk → arrivals → tracks play (bundled short test MP3s, no network); a native-path test driven by `adb emu geo fix` sequences (script in `mobile-flutter/tool/`).
- Site/backend: `node --test` for `backend/mobile-auth.mjs` (happy path, wrong verifier, reused code, expired code, no session, missing CSRF/Origin, rate limit, `authProvider` preserved so Telegram re-auth/deletion works) and `/api/legal/publication`; Vitest for the export tests and the two `app-auth` pages' pure logic; `pnpm check` must pass. Never call paid external APIs (ElevenLabs, LLMs) or real Telegram OAuth in tests.
- Before each Flutter commit: `pnpm mobile-flutter:check`; before each site commit: `pnpm check`.
- Manual: Step 0 and Step 9 tables on real devices.

## Out of scope

- Any change to the Capacitor project or its plan; publishing both apps.
- iOS implementation (backlog only), CarPlay/Android Auto, home-screen widgets, Wear OS.
- Admin panel; the classic bundled tour on `/`.
- Analytics SDKs, push notifications, OTA code push (Shorebird), cloud CI/CD.
- Bearer-token auth or other backend auth redesign; importing guest walks from the site's localStorage.
- Offline map tiles (the site does not cache tiles either).
- Refactoring the site's walk logic out of `tour-experience.tsx` into a shared pure reducer — a worthwhile follow-up to reduce TS/Dart drift, proposed separately.
- Huawei AppGallery and other stores.

---
**Maintenance note (for the implementing agent):** when this plan is implemented, update the `Status:` line above, e.g. `Status: implemented YYYY-MM-DD in branch `feat/<name>``. If the plan changes during implementation, update the affected sections too — the plan must not lie about what was built.
