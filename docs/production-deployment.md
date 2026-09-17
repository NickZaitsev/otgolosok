# Production deployment

Production: https://otgolosok.softmg.tech

Infrastructure scripts live in `/Users/fenix007/projects/utils/services` (not a
Git repository). Use its `deploy-otgolosok-prod` and
`deploy-otgolosok-generator` Make targets with `VPS=services@93.189.230.19`.
The generator target uses `deploy-scripts/otgolosok-generator-compose.yml`.

Do not deploy the root development Compose file over production. Nginx remains
in its existing project; the single generator and Valhalla share the
`otgolosok-generator` project and external `otgolosoksoftmgtech-net` network.
Traefik routes `/api/story-*`, exactly `/api/walk-plan`, exactly
`/api/walk-research-jobs`, and `/api/walk-research-jobs/` descendants (including
`/:id/retry`) to the generator with priority 100.
Admin API authentication remains in the backend.

## Локальный TTS

`LOCAL_TTS_ENGINE=silero` (по умолчанию) или `f5` выбирает профиль новых партий
и ручной озвучки. После изменения нужен перезапуск backend. Созданные задания
сохраняют профиль и ждут подходящий воркер; автоматического fallback нет.

Для F5 обязательны `F5_MODEL_SHA256`, `F5_REFERENCE_ID` и `F5_CONFIG_SHA256`;
при необходимости задаётся `F5_REFERENCE_SHA256`. Значения должны совпадать с
профилем just-tts. Серверный переключатель не запускает локальный воркер: ему
отдельно задаются `TTS_ENGINE=f5`, `WORKER_PROFILE_ID=f5-ru-v1` и пути к Portable.

The site directory is `/srv/sites/otgolosok.softmg.tech`:

- `generator-compose.yml`: production backend and routing services.
- `.generator.env`: existing credentials; never print or commit its contents.
- `generator-data`: existing SQLite database and audio; preserve this directory.
- `valhalla-data`: persistent Moscow graph, built from BBBike Moscow.osm.pbf.
- `backups`: private deployment archives including credentials and stopped SQLite.

Valhalla is pinned to
`ghcr.io/valhalla/valhalla-scripted@sha256:64b8f444a39521a8409ae39c8c1f5a80ec8d7167af906d9767c0bbea704fadc7`.
It uses one build/server thread, 0.75 CPU, 768 MiB RAM and a 1280 MiB combined
RAM/swap ceiling. Port 8002 is internal only. Readiness probes `/status`;
the generator uses `WALK_ROUTER_URL=http://valhalla:8002/route`.

Ordinary `/api/walk-plan` automatic stop discovery uses the bundled Moscow OSM catalog. The infrastructure
template retains `WALK_OVERPASS_URL=https://maps.mail.ru/osm/tools/overpass/api/interpreter`,
but the ordinary planner only uses this URL if `WALK_DISCOVERY_SOURCE=overpass`
is explicitly set. Opt-in walk research independently uses `WALK_OVERPASS_URL`
for addressed-building discovery, not the offline catalog. It allows one bounded
OSM request per discovery attempt (12-second client deadline, 1 MiB response,
160 elements, at most three candidates); see `backend/WALK_RESEARCH.md`.
The planner retains its 12-second deadline and concurrency limit. No automatic
multi-provider retries or fabricated route fallbacks are used. Refresh the
catalog alongside the Valhalla extract; see `content/walk-builder.md`.

The generator deployment builds/waits for Valhalla before replacing the backend,
waits at most ten minutes for existing jobs to become idle, stops the single
generator, archives its data/configuration, then recreates it. Never use
`down -v`, prune, or launch another worker on the same SQLite database.

## Verification on 2026-09-08

- `make deploy-otgolosok-prod`: lint, TypeScript, 138 frontend tests, 68 backend
  tests, static build and Nginx deployment passed.
- `make deploy-otgolosok-generator`: completed after resuming a local command
  timeout; the persistent cold graph build continued on the VPS.
- `/walk`, `/create`, `/admin`: HTTP 200.
- `/api/story-service`: HTTP 200, generation enabled.
- `/api/story-admin/jobs` without credentials: HTTP 401.
- Cross-origin POST `/api/walk-plan`: HTTP 403.
- Same-origin manual loop: HTTP 200, 970 m, 12 minutes, 71 geometry points.
- Same-origin manual open route: HTTP 200, 485 m, 6 minutes, 36 geometry points.
- Automatic discovery after the endpoint update: both public same-origin
  requests returned HTTP 200 from an Arbat start, with four discovered stops.
  Loop: 2123 m, 28 minutes, 192 geometry points, 2.1-second response.
  Open: 1212 m, 16 minutes, 112 geometry points, 0.7-second response.
- Valhalla and generator healthy; Valhalla had no OOM or restarts.
- SQLite quick check passed; six jobs unchanged (one ready, one failed, four
  requiring review). No generation jobs or paid AI calls were initiated.
- Backup: `backups/generator-20260908T072153Z/generator.tar.gz`, mode 0600.
- Endpoint-update backup: `backups/generator-20260908T072816Z/generator.tar.gz`,
  mode 0600. Generator redeployed while idle; Valhalla was not restarted.
- Walk planner and server regression tests: all 18 passed for the endpoint update.

The initial HTTP 406 diagnosis was from a diagnostic request without the
application's headers, not evidence of invalid Overpass QL. Repeating that
headerless request reproduced 406, while the exact application POST succeeded
against `overpass-api.de` but also exceeded the planner deadline on a public
loop request. Private Coffee and Kumi failed the bounded planner probes.
The Mail.ru endpoint passed both loop/open probes from the backend container,
then both public API checks after deployment. Public Overpass availability is
still an external dependency; failures remain bounded and return honest errors.

After the graph build, the VPS had approximately 12 GiB disk free and 1.3 GiB
available RAM, but only 291 MiB swap free. Monitor memory pressure before
increasing graph coverage or concurrency.

## Yandex TTS deployment — 2026-09-08, 13:43 UTC

- Deployed application revision `31cfef7` using both standard Make targets.
- Added `YANDEX_TTS_API_KEY` from the local environment to `.generator.env`,
  preserving existing production credentials. The default Yandex voice is `marina`.
- Prior environment backup: `backups/env-yandex-20260908T134219Z/.generator.env`;
  generator/data backup: `backups/generator-20260908T134250Z/generator.tar.gz`.
  Both credential-bearing files are private (0600).
- Lint, TypeScript, 143 frontend tests, 89 backend tests and static build passed.
- `/`, `/admin`, `/create`, `/walk` and `/api/story-service` returned HTTP 200;
  generation is enabled. Unauthenticated admin access returned HTTP 401.
- Authenticated production admin API exposes 18 Yandex and 13 OpenAI voices.
  Browser checks passed for login, provider/voice selection, mobile layout and
  logout without changing or approving any existing job.
- Live SpeechKit request from the production container with voice `kirill`
  returned HTTP 200 and a valid 3.96-second MP3. The temporary sample was removed.
- All nine job records remained byte-for-byte unchanged; SQLite quick check passed.
  Generator and Valhalla are healthy; Valhalla was not restarted.

## Editorial tables and revoicing deployment — 2026-09-08, 14:37 UTC

- Deployed application revision `0defcd8`: generator first, then frontend using
  the standard Make targets. Lint, TypeScript, 152 frontend tests, 110 backend
  tests and the static build passed.
- Backup: `backups/generator-20260908T143614Z/generator.tar.gz`, mode 0600.
  The generator was idle before replacement; Valhalla was not restarted.
- All nine existing job records remained byte-for-byte unchanged. SQLite quick
  check passed; the migration initialized four walk chapters.
- `/`, `/admin`, `/create`, `/walk` and `/api/story-service` returned HTTP 200.
  Production `/admin` HTML matches the local build byte-for-byte.
- Authenticated admin endpoints expose address relevance flags, the built-in
  walk and its four chapters, 13 OpenAI voices and 18 Yandex voices. Public
  `/api/story-walks/msk-kozhevniki-zindel-short` returns the published route.
  Unauthenticated walk-admin access returns HTTP 401.
- The reported job `5a242404-42b6-431b-95c6-d395b7656ee5` remains failed with
  `canRetry: true`; deployment did not resume it or initiate paid synthesis.
- Generator and Valhalla are healthy with zero restarts.

## Walk discovery outage fix — 2026-09-08, 14:59 UTC

- Reproduced automatic `/api/walk-plan` returning HTTP 503 after 12 seconds,
  while a manual pedestrian route returned HTTP 200. Mail.ru Overpass requests
  alternated between success and timeout; other public instances also failed
  bounded probes. The routing graph was healthy.
- Replaced default external discovery with a bundled catalog of 229 addressed
  historic, heritage or museum buildings, extracted from the existing production
  `Moscow.osm.pbf`. Source SHA-256:
  `86b5684276bc35a231cd3afba53647cd261731eccba34bdf89f9d553ba2a91b5`.
  Catalog generation skipped no incomplete building geometries. Refresh this
  snapshot when updating the graph's source extract.
- Optional Overpass discovery now has its own public error code and recommends
  adding manual stops; it no longer reports a routing outage.
- Lint, TypeScript, 152 frontend and 114 backend tests passed. A synthetic OSM
  fixture verified node, way and multipolygon centers and deterministic output.
- Six pre-deployment loop/open probes from Arbat, Kozhevnicheskaya and
  Lavrushinsky used only internal Valhalla requests and completed in 63–256 ms.
- Deployed with `make deploy-otgolosok-generator`. Backup:
  `backups/generator-20260908T145925Z/generator.tar.gz`. The generator was idle
  before replacement; Valhalla was not restarted.
- Public automatic loop/open requests with 30-, 60- and 90-minute budgets and a
  manual route all returned HTTP 200 (76–1583 ms). `/walk` and
  `/api/story-service` returned HTTP 200; cross-origin planning returned 403.
- All nine existing jobs remained byte-for-byte unchanged; SQLite quick check
  passed. No story generation or speech synthesis was requested.
- Browser interaction verification was unavailable: the in-app execution tool
  was absent and the separate browser connector reported an occupied profile.
  Public endpoint checks and automated frontend tests passed as described above.

## Opt-in walk research deployment, 2026-09-09, 11:17 UTC

- Deployed revision `ca6d386aa5222ed77f093f9adc666e926dccd0bc`, generator first,
  then frontend, using both standard infrastructure Make targets with
  `VPS=services@93.189.230.19`. No root development Compose deployment was used.
- Lint, TypeScript, 162 frontend tests, 140 backend tests and static build passed,
  including a repeat through the standard frontend deployment target.
- Production generator image:
  `sha256:8626551e1db2517858d2d92940397e2ffab4731828b7852c3bf88f6cb07e8eda`.
  Backend source checksum comparison found no differences; container server and
  research module hashes match the local revision. `/walk`, `/create`, `/admin`
  returned 200 and matched the deployed local HTML byte-for-byte.
- `/api/story-service` returned 200 with `enabled:true`. Random-ID research GET,
  unregistered recovery-token lookup, and random-ID retry POST returned JSON 404.
  Research POST without consent returned 400, foreign-origin POST returned 403,
  and unauthenticated `/api/story-admin/jobs` returned 401. No valid-consent
  research POST or retry of an existing job was made.
- Public automatic Gorky Park loop (`55.731,37.601`, 30 minutes) returned 200:
  2373 metres, 30 walking minutes, two stops and 136 geometry points.
- Direct read-only `createResearchDiscovery` probes from the running container
  used the existing Mail.ru Overpass URL only. The first failed boundedly with
  `WALK_DISCOVERY_UNAVAILABLE` after 12.1 seconds; the second returned three OSM
  candidates in 2.156 seconds. External discovery remains intermittent; this is
  not evidence that the full paid research/narration pipeline succeeds live.
- All nine job rows, three retry rows and four walk-chapter rows retained their
  pre-deployment SHA-256 hashes. SQLite `quick_check` returned `ok`; new tables
  `walk_research_cache` and `walk_research_grants` are empty. Job states remain
  two ready, one failed, one insufficient-evidence and five review-required.
  No jobs, quota reservations, research-provider calls or TTS were initiated by
  deployment verification.
- The generator was idle before replacement. Generator and Valhalla are healthy,
  with zero restarts; Valhalla retained its container ID and September 8 start
  time. Existing credentials and persistent data were preserved.
- Private generator backup (0600):
  `backups/generator-20260909T111619Z/generator.tar.gz`. Separate ingress config
  backup: `backups/ingress-20260909T111541Z/{traefik.yml,nginx.conf}` (0600 files).
- Recovery-token privacy is configured at both ingress layers. Traefik v2.11.56
  includes query strings in `RequestPath`, so its enabled JSON access log now
  drops that field globally (host/router/status remain available). This required
  one shared Traefik restart before deploying the research API. Eleven subsequent
  site requests across both routers had no `RequestPath` or recovery-token query
  content in access logs. Path-level traffic reporting is consequently unavailable.
- Production Nginx differs from `docker/nginx.conf`: it serves static files and
  does not proxy the API. The infrastructure static deployment now installs a
  site-specific `api_private` log format using `$uri`, without queries or Referer,
  and applies it at server scope. Candidate and live `nginx -t` checks passed.
  The development Nginx config was not copied over production.
- Infrastructure edits: `deploy-scripts/otgolosok-generator-compose.yml` (routes),
  `deploy-scripts/deploy-static.sh` (site log privacy),
  `deploy-scripts/beget-init.sh` and `deploy-panel/app.js` (Traefik config templates).
  Live `/srv/traefik/traefik.yml` has the matching access-log field exclusion.
  Shell syntax and panel JavaScript syntax checks passed.
- Verification did not exercise a paid research/narration job or browser UI.
  No commits or pushes were made during this deployment.
