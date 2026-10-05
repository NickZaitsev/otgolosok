# Plan: iOS and Android apps for App Store, Google Play and RuStore (Capacitor shell)

Status: in progress since 2026-10-05. Scope cut to Android (Google Play + RuStore) on 2026-10-05 — see Approved decision 8; iOS items are deferred.

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.

## Context

Otgolosok is a location-aware audio guide for Moscow, shipped today as a PWA: a static Next.js export (`out/`) served by nginx at https://otgolosok.online, a Node backend behind `/api/` (Traefik routes `/api/` to the generator container; production nginx serves only the static export, see `docs/production-runbook.md`). The owner wants the product in **App Store, Google Play and RuStore**.

Why a native shell, and not "just the site":

- Apple routinely rejects apps that only wrap a website (App Review Guideline 4.2 "Minimum Functionality"). The app needs native value.
- The product is meant to be heard "with the phone in a pocket" (`PRODUCT.md`), but in a browser the walk only works with the screen on: geolocation stops when the page is hidden, so today the walk screen holds a Screen Wake Lock (`src/lib/wake-lock.ts`, used in `src/features/tour/tour-experience.tsx:212`). A native app can track location and start the next chapter with the screen off — this is the main user-facing reason for the app and the main argument for App Review.

Chosen approach: **Capacitor** (https://capacitorjs.com, current stable `@capacitor/core` 8.5.2 at plan time) native shells for iOS and Android that **load the production site** (`server.url = https://otgolosok.online`) and expose a small set of native plugins to the page through the Capacitor bridge. The site keeps its origin, so cookies (`__Host-otgolosok-session`), CSRF, relative `/api/...` calls, the Service Worker offline shell and share links keep working unchanged, and every site deploy reaches the app instantly without a store release.

Known trade-off: Capacitor documents `server.url` as "intended for use with live-reload servers… not intended for use in production". We accept this deliberately (bundling the site would require absolute API URLs, CORS, cross-site/bearer auth, rewriting offline kits because Service Workers do not run on the iOS `capacitor://` scheme, and rewriting share links built from `location.origin`). The plan compensates with: a bundled error page, iOS App-Bound Domains, strict navigation rules, feature detection of native plugins, and an explicit device feasibility step (Step 1.4) before any adapter work.

External costs: Apple Developer Program $99/year, Google Play one-time $25, RuStore free. No paid APIs are called by this work.

## Approved decisions

1. Native shells are built with Capacitor (latest stable major, 8.x at plan time) for iOS and Android. No React Native / Flutter rewrite, no Android-only TWA.
2. The shell loads the production site (`server.url`), the site is **not** bundled into the app. Site updates reach the app without store releases; native changes require a store release.
3. Everything lives in **this repository**; native projects go under `mobile/`. The web adapters that call native plugins live in `src/` next to the code they replace.
4. Target stores: **App Store, Google Play, RuStore**.
5. Developer accounts "probably already exist" — Step 1.0 verifies them before any store record is created.
6. There is **no Mac right now**. Android work (scaffolding, adapters, builds) proceeds on Windows. The iOS build path (borrowed/found Mac vs. cloud macOS CI) is decided at the gate in Step 1.0; adding CI is infrastructure and needs the user's explicit approval (AGENTS.md YAGNI rule).
7. Two stages: **Stage 1** — shell, native share/keep-awake/geolocation, app links, test builds (TestFlight, Play testing track, RuStore draft). **Stage 2** — screen-off walk mode (background geolocation + next chapter with the screen locked). **App Store submission only after Stage 2.**
8. **Scope cut (2026-10-05): Android only — Google Play and RuStore.** iOS is deferred to a later iteration (no Mac). Do **not** implement any iOS-only item of this plan; they stay in the text as the future iOS backlog. Deferred items: `@capacitor/ios` dependency, `mobile:ios` script, `ios.path` and `ios.limitsNavigationsToAppBoundDomains` in the config, `npx cap add ios`, the whole iOS part of 1.2, the opaque 1024 App Store icon requirement (generate Android resources only), the iPhone items of 1.4/2.0, `public/.well-known/apple-app-site-association` and its nginx location (1.6), TestFlight (1.8), iOS parts of 2.1/2.4, App Store parts of Stage 3, the Apple account/Team ID/iOS build path questions in 1.0. Web adapters in `src/lib/native/` stay platform-neutral (`nativePlatform()` still returns `"ios" | "android" | null`) so iOS can be added later without rewriting them. Google Play and RuStore public release stays after Stage 2 (at least after the Android media controls of 2.4: without them the app would regress against Chrome, which shows lock-screen controls for the PWA).

Planner defaults (not discussed explicitly; the implementing agent must confirm the first one with the user before creating any store record, the rest may be changed if the user objects):

- Bundle ID / application ID `online.otgolosok.app` (reverse of the production domain). It is immutable after the first store upload. **Confirmed by the user on 2026-10-05.**
- Display name «Отголосок»; Russian as the development region and the only localization.
- iPhone only (no iPad target), portrait only — matches `orientation: "portrait"` in `src/app/manifest.ts`.
- Google Play and RuStore public release also after Stage 2 (Android WebView has no lock-screen media controls; parity comes with Stage 2, see Step 2.4). Testing tracks start in Stage 1.
- A privacy policy page on the site (`/privacy`) — all three stores require a privacy policy URL; none exists today.

## Key codebase facts

- Static export: `next.config.ts` has `output: "export"`; `pnpm build` = `build-walk-catalog.mjs` → `next build` → `build-content-security-policy.mjs` → `build-service-worker.mjs` (`package.json`). Node ≥ 24.20, pnpm 10.24 (`packageManager`). `pnpm check` runs lint, typecheck, Vitest + `node --test backend/*.test.mjs`, Python checks and the build.
- Runtime dependencies in `package.json` are pinned to exact versions; keep that style for Capacitor packages.
- `pnpm-workspace.yaml` only lists `ignoredBuiltDependencies`; the repo is a single package. ESLint ignores are in `eslint.config.mjs` (`globalIgnores`); `tsconfig.json` includes `**/*.ts` (so a root `capacitor.config.ts` is type-checked by `pnpm typecheck`).
- **CSP** is a `<meta http-equiv="Content-Security-Policy">` injected into every exported HTML by `scripts/build-content-security-policy.mjs` using `scripts/content-security-policy.mjs`: `script-src 'self' <Yandex Metrika origins> https://yastatic.net <sha256 hashes of inline scripts>` — **no `'unsafe-inline'`**. If Capacitor injects its bridge as an inline `<script>` into the remote HTML (Android proxy path), CSP will block it. This is the first thing Step 1.4 verifies.
- Auth: Better Auth in `backend/auth.mjs` with `basePath: "/api/auth"`, `trustedOrigins: [baseURL]`, `sameSite: "lax"`, production cookie `__Host-otgolosok-session`; email/password only (no social login → Sign in with Apple is **not** required). Client in `src/features/auth/client.ts` uses `credentials: "same-origin"` and a CSRF token in `sessionStorage`. Remote mode keeps the same origin, so no auth changes are expected.
- Account deletion already exists: `src/features/account/account.tsx:102` («Удалить аккаунт», password-confirmed) — satisfies Apple Guideline 5.1.1(v).
- API calls are relative (`/api/...`) in ~18 files (e.g. `src/features/walk-builder/use-walk-draft.ts`, `src/features/walks/walk-loader.ts`); share links use `location.origin` (`src/features/explore/share-place-button.tsx:29`, `src/features/walks/walk-library.tsx:69`, `src/features/admin/shared-walk-admin.tsx:67`). All of this is why the shell loads the real origin.
- Service Worker: registered in `src/features/tour/use-offline-shell.ts:28` (`/sw.js`, scope `/`), auto-update deferred while a walk/creation/offline save/audio is active (`tour-experience.tsx:75-76`, `src/lib/offline/auto-update.ts`). Precache is an allowlist (`scripts/service-worker-manifest.mjs`), so new files like `/.well-known/*` are not precached.
- Geolocation has two entry points, both accept an injected `Geolocation`-like object:
  - continuous: `createBrowserPositionSource({ geolocation?, positionOptions? })` in `src/lib/position/browser.ts`, implementing `PositionSource` (`src/lib/position/types.ts`, `kind: "browser" | "replay"`), chosen in `src/features/tour/use-walk-position.ts:76-80`; fixes go through `processFix` (`src/lib/geo/trigger.ts`) and `options.onEntered()` starts the next chapter.
  - one-shot: `locateOnce(listener, { geolocation?, permissions?, … })` in `src/lib/position/locate.ts:57`, called from `src/features/explore/around-screen.tsx:221` and `src/features/walk-builder/walk-creation-panel.tsx:60`.
  - User-facing errors say «Разрешите его в настройках браузера.» (`browser.ts`) — wrong wording inside an app.
- Share: `sharePlace(data, env: ShareEnvironment)` in `src/features/explore/share-place.ts` with injectable `{ share?, canShare?, writeText? }`; `browserShareEnvironment()` is used in `share-place-button.tsx:32`. `AbortError` from `share` means "user closed the sheet".
- Wake lock: `createWakeLockController({ navigator?, document?, onChange? })` in `src/lib/wake-lock.ts`, `navigator` is a `WakeLockNavigatorLike` (`wakeLock.request("screen")` → sentinel with `release()` and `release` event). Created in `tour-experience.tsx:212`.
- Media Session: `src/lib/audio/media-session.ts` with injectable `MediaSessionEnvironment { session, createMetadata }`; drives lock-screen/headset controls (play, pause, seek ±15 s, next/previous). Audio uses a single `HTMLAudioElement` (`src/lib/audio/audio-element.ts`, unlock timeout 3 s, play timeout 10 s).
- Place links: `src/features/explore/place-link.ts` exports `PLACE_PARAM`, `isPlaceId`, `readPlaceParam`, `placeMapUrl(id)`, `placeSharePath(id)`, `placeShareUrl(id, origin)`. Map URL `/?place=osm:<type>:<number>`, share URL `/place/<type>/<number>` (backend preview page with Open Graph, then `location.replace` to the map). In-page URL changes must go through `history.pushState({}, "", url)` as `usePlaceUrl()` does — never `router.push`/`location` for same-page place changes (`docs/agents/place-links.md`). Other app links: `/?job=<id>`, `/walk?share=<token>`.
- Viewport uses `viewportFit: "cover"` (`src/app/layout.tsx`) and safe-area tokens `--safe-top/right/bottom/left` = `env(safe-area-inset-*, 0px)` in `src/styles/tokens.css:59-62`.
- Icons: `scripts/build-app-icons.mjs` rasterizes `src/app/icon.svg` via Playwright Chromium into `public/icons/` (has a full-bleed variant without `rx`). Brand colors in the manifest: background `#eee9df`, theme `#b52d20`.
- Yandex Metrika is loaded on every page (`src/app/layout.tsx`, `src/features/analytics/`), with Webvisor; it must be declared in store privacy forms.
- Production nginx config is **not** in this repo: it lives in the external `services` project (`/Users/fenix007/projects/utils/services`, local Git without remote). `docker/nginx.conf` here is the Compose stack (`location / { try_files $uri $uri.html $uri/ =404; }`).
- Git remotes: `origin` = github.com/softmg/otgolosok, `fork` = github.com/NickZaitsev/otgolosok. No `.github/` workflows exist.
- Capacitor plugin versions at plan time: `@capacitor/core|cli|ios|android` 8.5.2, `@capacitor/app` 8.1.2, `@capacitor/geolocation` 8.2.3, `@capacitor/share` 8.0.3, `@capacitor/splash-screen` 8.0.2, `@capacitor-community/keep-awake` 8.0.1, `@capacitor-community/background-geolocation` 1.2.26 (peer `@capacitor/core >=3`, README compatibility table lists Capacitor up to v7 — Capacitor 8 compatibility must be verified). `@jofr/capacitor-media-session` is stale (peer `^6`, last publish 2024) — do not use.

## Implementation

### Stage 1 — Shell and test builds

#### 1.0 Preconditions (with the user, before any code that depends on them)

Ask the user in Russian and record answers in `docs/agents/mobile-app.md` (no secrets, no passwords, no personal data):

- Apple Developer: account exists and is active; individual or organization; **Team ID** (needed for `apple-app-site-association`); who has Admin/App Manager access.
- Google Play Console: account exists; personal or organization; creation date. Personal accounts created after 2023-11-13 must run a **closed test with ≥12 testers for 14 days** before production access — if so, start the closed test as early as possible in Stage 1.
- RuStore console: account exists (individual/company).
- Confirm the bundle/application ID (`online.otgolosok.app` proposed) — immutable after first upload.
- **iOS build path gate**: (a) a Mac with current Xcode is available, or (b) cloud macOS CI (GitHub Actions macOS runner + fastlane, or Codemagic). Option (b) is new infrastructure — do not add it without explicit approval. Until resolved, skip iOS-only steps and continue with Android.
- Privacy policy text owner and support contact (email or URL) for the store listings.

#### 1.1 Scaffold Capacitor

- Root `package.json`:
  - dependencies (exact versions): `@capacitor/core`, `@capacitor/app`, `@capacitor/geolocation`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar`, `@capacitor-community/keep-awake`, `@capacitor/android`, `@capacitor/ios`.
  - devDependencies: `@capacitor/cli`, `@capacitor/assets`.
  - scripts: `"mobile:sync": "cap sync"`, `"mobile:android": "cap open android"`, `"mobile:ios": "cap open ios"`.
  - Plugin JS packages live in the root package because the **site** imports them; `cap sync` reads the same `package.json`, so native and web plugin versions cannot drift.
- `capacitor.config.ts` at the repo root (the CLI resolves plugins from the `package.json` next to it); native projects are placed under `mobile/` with `android.path: "mobile/android"` and `ios.path: "mobile/ios"`. Contents:
  - `appId`, `appName: "Отголосок"`, `webDir: "mobile/www"`.
  - `server.url` from `process.env.OTGOLOSOK_APP_URL`, default `"https://otgolosok.online"`. Throw at config load if the URL is not `https:`, unless `OTGOLOSOK_APP_DEV=1` is set (then `cleartext: true` is allowed for a LAN `pnpm dev`; never committed as default).
  - `server.errorPath: "error.html"`.
  - No `server.allowNavigation` (other hosts must open in the system browser). Do not enable `CapacitorHttp` or `CapacitorCookies` (defaults are off; they would reroute `fetch`/cookies through native code and break same-origin auth assumptions).
  - `ios.limitsNavigationsToAppBoundDomains: true`.
  - `plugins.SplashScreen`: auto-hide after the first page load, background `#eee9df`.
- `mobile/www/index.html` (minimal placeholder, required by `cap sync`) and `mobile/www/error.html`: Russian offline/error page («Нет подключения к интернету», «Повторить» → `location.href = "https://otgolosok.online/"`), self-contained (inline CSS, no external requests), brand colors. Note: on Android the error page has no plugin access.
- Generate platforms: `npx cap add android` (Windows). `npx cap add ios` on the Mac/CI from the gate in 1.0; if the CLI allows generating it on Windows (SPM template), generate there and leave compilation to the Mac/CI.
- `.gitignore`: Capacitor's generated `.gitignore` files inside `mobile/android` and `mobile/ios` cover build outputs and copied web assets — keep them. Add at the root: `*.keystore`, `*.jks`, `mobile/android/keystore.properties`, `*.p8`, `*.p12`, `*.mobileprovision`, `mobile/ios/App/fastlane/report.xml` (only if fastlane is approved).
- `eslint.config.mjs` `globalIgnores`: add `mobile/android/**`, `mobile/ios/**` (they contain copied third-party JS such as `native-bridge.js`).

#### 1.2 Native project configuration

iOS (`mobile/ios/App/App/Info.plist`, entitlements, `AppDelegate.swift`):

- `NSLocationWhenInUseUsageDescription` (Russian, e.g. «Отголосок определяет, где вы, чтобы включать истории рядом с местом событий. Координаты остаются на устройстве.»).
- `WKAppBoundDomains`: `otgolosok.online` (+ `localhost`, as Capacitor requires for its own scheme). Max 10 entries. Required for Service Workers and cookie/JS-injection reliability in WKWebView with a remote origin.
- `UIBackgroundModes`: `audio` (stories keep playing with the screen locked — current web behavior must not regress).
- `ITSAppUsesNonExemptEncryption = false` (HTTPS only).
- `CFBundleDevelopmentRegion = ru`; supported orientations: portrait only; `TARGETED_DEVICE_FAMILY = 1` (iPhone).
- `AppDelegate`: on launch set `AVAudioSession` category `.playback`, mode `.spokenAudio`; wrap in `do/catch` and log the error (never crash). Without this, WKWebView audio stops on screen lock and is muted by the silent switch.
- Associated Domains entitlement: `applinks:otgolosok.online`.

Android (`mobile/android/app/src/main/AndroidManifest.xml`, `build.gradle`, `res/values/strings.xml`):

- Permissions: `INTERNET`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`. **No** `ACCESS_BACKGROUND_LOCATION` in any stage (Stage 2 uses a foreground service started from the foreground, which needs only while-in-use location and avoids Google Play's background-location declaration).
- Main activity `android:screenOrientation="portrait"`.
- App Links intent filter with `android:autoVerify="true"`, scheme `https`, host `otgolosok.online`, paths: `pathPrefix="/place/"`, `path="/walk"`, `path="/"`.
- Release signing: read keystore path/passwords from the gitignored `mobile/android/keystore.properties` or environment variables; fail the release build with a clear message if missing. Document in Russian in `docs/agents/mobile-app.md` how to back up the upload key (losing it blocks RuStore updates; Play can reset upload keys only through support).
- `targetSdk`/`compileSdk`: Capacitor 8 template defaults; verify they satisfy the current Google Play target API requirement at release time.

#### 1.3 Icons and splash

- Extend `scripts/build-app-icons.mjs` to also write `mobile/assets/icon.png` (1024×1024, **opaque**, full-bleed variant — App Store icons must not have alpha) and `mobile/assets/splash.png` (2732×2732, logo centered on `#eee9df`). Keep the existing outputs unchanged.
- Generate native icon/splash sets with `npx @capacitor/assets generate --assetPath mobile/assets` (verify flags against the installed version) and commit the generated native resources.

#### 1.4 Device feasibility check (gate — before adapter work)

Build a debug app pointing at production and verify on a **real Android phone** (and a real iPhone once the iOS path exists). Record every result with device/OS versions in `docs/agents/mobile-app.md`:

1. The Capacitor bridge is present on the remote page (`window.Capacitor?.isNativePlatform?.() === true`) **under our CSP**, with no CSP violations in the WebView console. If Android injects an inline bridge script that CSP blocks: prefer a Capacitor mechanism that injects via document-start scripts; only as a last resort add the bridge script hash to `scripts/content-security-policy.mjs` (fragile: it changes with every Capacitor upgrade — would need a check in `pnpm check`). Stop and report to the user if neither works.
2. Login persists across app restarts (cookie `__Host-otgolosok-session`), sign-out works, CSRF-protected POST works.
3. Service Worker registers and «Офлайн-копия готова» appears; with airplane mode the app restarts into the cached shell (iOS needs App-Bound Domains from 1.2). First launch without network shows `error.html`.
4. Map tiles (`tiles.versatiles.org`), Metrika, audio and images load (no blocked subresources on iOS App-Bound Domains).
5. Audio keeps playing with the screen locked for a full chapter on both platforms; whether lock-screen controls (Media Session) appear on iOS WKWebView and on Android WebView.
6. External links (fact sources, `target="_blank"`) open in the system browser; navigation never leaves `otgolosok.online` inside the WebView.
7. Android hardware Back walks the page history (place links, expanded story sheet) and exits only at the root.
8. Safe areas: header and bottom navigation clear the notch/status bar and gesture bar on both platforms (Android WebView may report `env(safe-area-inset-*)` as 0 under edge-to-edge; if so, use Capacitor's system-bars inset CSS variables as a fallback inside `--safe-*` in `src/styles/tokens.css`).
9. Web geolocation inside the WebView: number of permission prompts (iOS WKWebView with a remote origin is expected to show both the system prompt and a per-site prompt — confirming why 1.5 routes geolocation through the native plugin).

If any of items 1–3 fail without a clean fix, stop and report to the user with options before continuing — they are the foundation of the remote-shell approach.

#### 1.5 Web adapters for native features

New folder `src/lib/native/` (client-only modules; every module must be safe to import during static prerender and must not pull plugin code into the web bundle unless running natively):

- `platform.ts`
  - `nativePlatform(): "ios" | "android" | null` — reads `window.Capacitor` injected by the shell (no static import of `@capacitor/core`, so the web bundle is unchanged).
  - `hasNativePlugin(name: string): boolean` — `Capacitor.isPluginAvailable`. **Contract:** the site is updated instantly but users may run an older app binary, so every native feature must check availability and fall back to the web implementation.
- `geolocation.ts`
  - `appGeolocation(): Geolocation | null` — on native returns an object implementing `getCurrentPosition`, `watchPosition`, `clearWatch` on top of `@capacitor/geolocation` (lazy `import()`), mapping plugin positions to `GeolocationPosition`-shaped values and plugin errors to `GeolocationPositionError` codes 1/2/3 (the code in `locate.ts` relies on numeric codes); on web returns `navigator.geolocation ?? null`.
  - `appPermissions(): Pick<Permissions, "query"> | null` — on native answers `query({ name: "geolocation" })` from `Geolocation.checkPermissions()`; on web `navigator.permissions ?? null`.
  - Wire: `use-walk-position.ts:80` → `createBrowserPositionSource({ geolocation: appGeolocation() })`; `around-screen.tsx:221` and `walk-creation-panel.tsx:60` → `locateOnce(listener, { geolocation: appGeolocation(), permissions: appPermissions() })`.
  - Error texts: in the app, «…в настройках браузера» becomes «…в настройках телефона» (pass a platform-aware message; keep the browser text on the web).
- `share.ts` — `appShareEnvironment(): ShareEnvironment`: on native `share` calls `@capacitor/share` and rethrows a user cancel as an `Error` with `name = "AbortError"` (so `sharePlace` returns `"cancelled"`); `canShare` returns true; `writeText` keeps `navigator.clipboard`. On web returns `browserShareEnvironment()`. Wire in `share-place-button.tsx:32`. (Walk share links in `walk-library.tsx` copy to clipboard only — leave as is.)
- `keep-awake.ts` — `appWakeLockNavigator(): WakeLockNavigatorLike | undefined`: on native implements `wakeLock.request("screen")` with `@capacitor-community/keep-awake` (`keepAwake()` / `allowSleep()` in the sentinel's `release()`, dispatching `release`); on web returns `undefined` so the controller uses `navigator`. Wire in `tour-experience.tsx:212`.
- `status-bar.ts` — `setStatusBarForScreen(kind: "light" | "dark")`: native only, `@capacitor/status-bar` style (dark text on light screens, light text on the dark listening screen), overlay WebView kept; call where the dark walk screen mounts/unmounts. No-op on web and when the plugin is missing.
- `app-links.ts`
  - Pure `inAppPathFromUrl(url: string, appOrigin: string): string | null`: accepts only `https://otgolosok.online` (the configured origin); `/place/<type>/<number>` → `placeMapUrl("osm:<type>:<number>")` via `place-link.ts` helpers; `/`, `/?place=…`, `/?job=…`, `/walk?share=…` → same path+query; anything else (`/api/*`, `/admin*`, `/update.html`, foreign hosts, malformed) → `null`.
  - `listenForAppLinks(options)`: native only; handles `App.getLaunchUrl()` on start and `App.addListener("appUrlOpen")`. Navigation contract: if the target is `/?place=…` and the current page is `/`, use `history.pushState({}, "", path)` (same as `usePlaceUrl`); otherwise full navigation `location.assign(path)`. If a walk session is active (the same predicate used to defer auto-update in `tour-experience.tsx:75-76` — expose it via a small shared module instead of duplicating it), ask `window.confirm("Прервать прогулку и открыть ссылку?")` first.
- `src/features/native/native-shell.tsx` — client component rendering `null`, mounted once in `src/app/layout.tsx`; on native it starts `listenForAppLinks` and hides the splash screen after hydration. Does nothing on the web.

Error handling: every plugin call is wrapped at the adapter boundary; a rejected/missing plugin falls back to the web API and is reported through the existing error/telemetry path used in that feature (no new logging infrastructure). No retries — plugin failures are deterministic.

#### 1.6 App Links / Universal Links files

- `public/.well-known/apple-app-site-association` (no extension, JSON): `applinks.details[].appIDs = ["<TEAM_ID>.<bundle id>"]`, `components` for `/place/*`, `/` with `?place=` and `?job=`, `/walk` with `?share=`; explicit exclusions for `/api/*`, `/admin*`, `/update.html`.
- `public/.well-known/assetlinks.json`: package name + SHA-256 fingerprints of **every** signing certificate that ships to users — the Play App Signing key (from Play Console), the upload key, and the key used for RuStore builds.
- These values are public, not secrets; commit them once Step 1.0 provides Team ID and fingerprints.
- `docker/nginx.conf`: `location = /.well-known/apple-app-site-association { default_type application/json; … }` and `location = /.well-known/assetlinks.json` with `application/json`, no redirects, with `security-headers.conf`. Check that `next build` copies `public/.well-known/` into `out/`.
- Production nginx lives in the external `services` project: hand the user the exact change (content type, no dotfile deny for `/.well-known/`) — do not edit that repo without access/approval. After deploy verify: `curl -sI https://otgolosok.online/.well-known/apple-app-site-association` (200, `application/json`, no redirect), Apple CDN `https://app-site-association.cdn-apple.com/a/v1/otgolosok.online`, Google's Digital Asset Links API for `assetlinks.json`.

#### 1.7 Privacy policy page

- `src/app/privacy/page.tsx` («Политика конфиденциальности»), static, linked from the account page and the login page.
- The agent drafts the text from the **actual** data flows (verify each in code before writing): account email/name/password hash (Better Auth), account walks/favorites/reviews, guest device key for reviews, walk launch dedup marks (pseudonymous, ≤2 days per `docs/agents/walk-top.md`), IP for rate limits, Yandex Metrika incl. Webvisor, geolocation processed on device, a selected map point/address sent to the backend for geocoding, account deletion. The **user approves the final text** before it is published (legal content).
- Add the page to the precache allowlist only if offline access is wanted (default: no).

#### 1.8 Test builds

- Android: signed release AAB → Google Play internal testing (and the closed test from 1.0 if required); signed APK/AAB → RuStore console as a draft/test version (verify current RuStore upload format and signing rules; add its certificate fingerprint to `assetlinks.json`).
- iOS (when the gate in 1.0 is resolved): archive → TestFlight internal testing.
- Versioning: `versionName`/`CFBundleShortVersionString` semver starting `1.0.0`; `versionCode`/`CFBundleVersion` a monotonically increasing integer per upload. Document the bump procedure in `docs/agents/mobile-app.md`.
- Re-run the 1.4 checklist on the store-installed test builds (App Links verification only works with store/real signing).

#### 1.9 Documentation (Stage 1)

- `docs/agents/mobile-app.md` (Russian): architecture (remote shell, why), how to build/run on Android (Windows: JDK required by Capacitor 8, Android Studio/SDK) and iOS, signing and key backup, app-links files, the "older binary" compatibility rule, the 1.4 results table. Add it to `docs/agents/README.md` with a two-sentence description.
- `README.md`: short Russian section «Мобильное приложение» with commands (`pnpm mobile:sync`, `pnpm mobile:android`, `pnpm mobile:ios`) and a link to the note.

### Stage 2 — Walk with the screen off

#### 2.0 Device feasibility check (gate)

Prototype with `@capacitor-community/background-geolocation` (verify Capacitor 8 compatibility first) on real devices, walk or drive a test route, and record results:

1. JS in the WebView keeps receiving fixes with the screen locked for ≥ 10 minutes, on iOS and Android.
2. When a fix enters the next chapter's zone with the screen locked, the existing flow (`processFix` → `onEntered` → `playAudioSource`) starts the audio without a user gesture.
3. iOS works with **When In Use** authorization + `allowsBackgroundLocationUpdates` (blue status-bar pill), without requesting **Always**. If the plugin insists on Always, record it — App Review scrutinizes Always.
4. Android: updates do not stop after ~5 minutes in the background **without** `android.useLegacyBridge` (plugin README recommends `useLegacyBridge: true`; that exposes the bridge via `addJavascriptInterface` to all frames, including the third-party Metrika frames allowed by `frame-src` — enable only if the 5-minute stop reproduces, and record the risk).
5. Battery drain over a 60-minute walk on each platform.

If 1 or 2 fails on a platform: **stop**. The fallback is a native trigger + native player (porting `src/lib/geo/trigger.ts` to Swift/Kotlin and playing chapter audio natively) — a substantially larger scope that needs a separate plan and the user's approval.

#### 2.1 Native configuration

- iOS `Info.plist`: add `location` to `UIBackgroundModes` (keeping `audio`); add `NSLocationAlwaysAndWhenInUseUsageDescription` only if the plugin requires the key's presence (Russian text).
- Android manifest: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`; notification channel name, icon and color resources required by the plugin (`capacitor_background_geolocation_notification_*`), Russian texts (e.g. title «Идёт прогулка», text «Отголосок включит следующую историю, когда вы подойдёте к месту»).

#### 2.2 Background position source

- `src/lib/native/background-position.ts`: `createNativeBackgroundPositionSource(options): PositionSource` with `kind: "native"` (extend `PositionSourceKind` in `src/lib/position/types.ts` and the diagnostics label). Uses `addWatcher({ backgroundTitle, backgroundMessage, requestPermissions: true, stale: false, distanceFilter })` (tune `distanceFilter` from 2.0 measurements); maps plugin errors (`NOT_AUTHORIZED` → `permission-denied`, others → `unavailable`/`error`) into the existing status updates; `subscribe()` returns a stop function that calls `removeWatcher`.
- `use-walk-position.ts`: when `nativePlatform()` and `hasNativePlugin("BackgroundGeolocation")`, use the native source instead of the browser one; replay modes stay unchanged.
- Lifecycle: the watcher (and its foreground service/notification) exists only while a walk session is active; it is removed on walk stop/finish and on `pagehide`. Auto-update is already deferred during a walk.
- Permission UX: before the first background walk, explain in Russian why the location is used with the screen off; on Android 13+ request notification permission first (the foreground-service notification). If the user declines, the walk continues in the current mode (screen on via keep-awake) with a clear message — never a dead end.

#### 2.3 Keep-awake policy

When the native background source is active, do not keep the screen on (release keep-awake); when it is not available, keep the Stage 1 behavior.

#### 2.4 Lock-screen media controls parity

Use the 1.4 results:

- iOS: if WKWebView does not publish Now Playing info from `navigator.mediaSession`, add a minimal app-local Capacitor plugin (Swift, `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`) and a `MediaSessionEnvironment` adapter in `src/lib/native/media-session.ts`.
- Android: WebView does not show system media controls (expected). Add an app-local Capacitor plugin (Kotlin, `MediaSessionCompat` + media-style notification) that the `MediaSessionEnvironment` adapter drives (metadata, playback state, position, actions play/pause/seek ±15 s/next/previous). Prefer attaching the media controls to the walk's foreground-service notification to avoid two notifications; verify feasibility with the background-geolocation plugin's own notification, otherwise use a separate media notification.
- Plugins live in the native projects (`mobile/ios/App/App/Plugins/`, `mobile/android/app/src/main/java/.../plugins/`) and are registered in the app; the web adapter is feature-detected via `hasNativePlugin`.

#### 2.5 Documentation (Stage 2)

Update `docs/agents/mobile-app.md` with 2.0 results, chosen plugin settings, battery numbers, permission texts and known limitations.

### Stage 3 — Store publication (after Stage 2)

#### 3.1 Listings and compliance

- `mobile/store/` (Russian Markdown, committed): app name, subtitle, short/full descriptions per store, keywords (App Store), category (Travel / Путешествия), support URL, privacy policy URL, App Review notes, Play foreground-service justification text.
- Screenshots: required sizes for App Store (current required iPhone size class), Google Play phone screenshots + 1024×500 feature graphic, RuStore screenshots — captured from devices/emulators or Playwright at device sizes; store under `mobile/store/screenshots/`.
- Privacy forms: App Store privacy "nutrition labels", Google Play Data safety, RuStore equivalent — fill from the data-flow audit in 1.7 (Metrika: analytics/usage data, device identifiers; account: email/name; location: processed on device; selected address/point: sent for geocoding). Declare tracking as "no" only if Metrika data is not linked with third-party data for advertising — confirm with the user.
- App Review notes: the app is Moscow-specific; provide a demo account (created through normal sign-up, credentials entered only in App Store Connect / Play Console, never in the repo) and a screen recording of a real walk with the screen locked (needed for `location` + `audio` background modes). Google Play: the foreground-service (location) declaration with a video in Play Console.
- Age rating questionnaires in all three consoles.

#### 3.2 Release

- Bump versions, build release artifacts, upload: App Store (submit for review), Google Play (production or staged rollout from the testing track), RuStore (moderation).
- After approval: verify installs from each store, App Links/Universal Links from a messenger link `https://otgolosok.online/place/…`, login, offline start, a full screen-off walk.
- Record the outcome (dates, review feedback, rejections and fixes) in a new `docs/agents/mobile-release-<date>.md` and list it in `docs/agents/README.md`.

## Testing & verification

Automated (must pass on Windows; run `pnpm check` before every commit):

- Vitest, table-driven where applicable:
  - `src/lib/native/app-links.test.ts`: `/place/node/123` → `/?place=osm:node:123`; `/place/way/5` and `/place/relation/7`; `/?place=…`, `/?job=…`, `/walk?share=…` pass through; `/api/x`, `/admin`, `/update.html`, foreign host, `http:` scheme, malformed `/place/node/abc` → `null`.
  - `geolocation.test.ts`: plugin position → `GeolocationPosition` shape (accuracy, timestamp); plugin errors → codes 1/2/3; `clearWatch` stops callbacks; web fallback returns `navigator.geolocation`.
  - `share.test.ts`: native cancel → `sharePlace` returns `"cancelled"`; native failure → falls back to clipboard; missing plugin → browser environment.
  - `keep-awake.test.ts`: `request("screen")` → `keepAwake`, `release()` → `allowSleep` + `release` event; works with `createWakeLockController`.
  - `platform.test.ts`: no `window.Capacitor` → `null`; native iOS/Android; plugin availability false → features fall back.
  - Stage 2: `background-position.test.ts`: status/fix mapping, `NOT_AUTHORIZED` → `permission-denied`, stop removes the watcher exactly once, late callbacks after stop are ignored.
- `node --test`: a test that parses `public/.well-known/apple-app-site-association` and `assetlinks.json` as JSON, checks app IDs/package name match `capacitor.config.ts`, and that `/api/*` and `/admin*` are excluded.
- A test for `capacitor.config.ts`: default `server.url` is `https://otgolosok.online`, non-https URL throws without the dev flag, no `allowNavigation`, `CapacitorHttp`/`CapacitorCookies` not enabled.
- Playwright: the web must behave exactly as before — run `pnpm test:e2e` (at least walk/replay, place-links, story-sheet specs) since geolocation/share/wake-lock call sites change. Native adapters are inactive in a browser.
- Do not call paid external APIs from tests.

Manual (record in `docs/agents/mobile-app.md`): the 1.4 and 2.0 checklists on real devices, then a full real walk in Moscow per stage, plus store-installed test builds (App Links only verify with real signing).

## Out of scope

- Bundling the site into the app, OTA update services (Capgo/Appflow), offline first launch without any prior network access.
- React Native / Flutter / fully native rewrite; Android TWA.
- The native trigger + native player fallback from 2.0 (separate plan if needed).
- Push notifications, in-app purchases/subscriptions, Sign in with Apple, social login.
- Cloud CI/CD for builds unless explicitly approved at the gate in 1.0.
- iPad layouts, landscape app orientation, Android tablets optimization, CarPlay/Android Auto, widgets.
- Huawei AppGallery and other stores.
- Analytics changes (AppMetrica, separating app traffic in Metrika) — can be proposed later.
- Changes to the external `services` repository (the agent provides the exact nginx change; the owner applies it).

---
**Maintenance note (for the implementing agent):** when this plan is implemented, update the `Status:` line above, e.g. `Status: implemented YYYY-MM-DD in branch `feat/<name>``. If the plan changes during implementation, update the affected sections too — the plan must not lie about what was built.
