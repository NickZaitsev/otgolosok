# Production deployment

Production: https://otgolosok.softmg.tech

Infrastructure scripts live in `/Users/fenix007/projects/utils/services` (not a
Git repository). Use its `deploy-otgolosok-prod` and
`deploy-otgolosok-generator` Make targets with `VPS=services@93.189.230.19`.
The generator target uses `deploy-scripts/otgolosok-generator-compose.yml`.

Do not deploy the root development Compose file over production. Nginx remains
in its existing project; the single generator and Valhalla share the
`otgolosok-generator` project and external `otgolosoksoftmgtech-net` network.
Traefik routes `/api/story-*` and exactly `/api/walk-plan` to the generator.
Admin API authentication remains in the backend.

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

Production explicitly sets
`WALK_OVERPASS_URL=https://maps.mail.ru/osm/tools/overpass/api/interpreter`
in the infrastructure Compose template. Discovery retains its existing POST
method, application headers, query, 12-second deadline and concurrency limit.
No automatic multi-provider retries or fabricated route fallbacks are used.

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
