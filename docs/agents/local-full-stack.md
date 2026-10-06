# Локальный запуск с API и данными

`pnpm dev` поднимает только интерфейс: запросы `/api/*` отвечают 404, на карте нет мест, прогулки не строятся. Для проверки с данными нужен backend, который отдаёт и API, и собранный фронтенд из `out/`.

## Порядок

1. Node — строго версия из `.nvmrc` (24.20.0): `fnm install 24.20.0`. Homebrew-версия 25 подхватывается раньше, а `engines` в `package.json` (`>=24.20.0`) её пропускает.
2. База: `make db-dump && make db-import` (места, озвучка, фото). Прогулки по ссылке `?share=` хранятся с пользовательскими данными и в выгрузку не входят.
3. Маршрутизатор: Valhalla из Docker-стека не публикует порт. Проброс: `docker run -d --rm --name otgolosok-valhalla-local --network otgolosok_default -p 127.0.0.1:8002:8002 alpine/socat tcp-listen:8002,fork,reuseaddr tcp-connect:valhalla:8002`.
4. `pnpm build`, затем `WALK_ROUTER_URL=http://127.0.0.1:8002/route WALK_TRACE_URL=http://127.0.0.1:8002/trace_attributes STATIC_DIR=out fnm exec --using=24.20.0 node backend/server.mjs`, адрес http://127.0.0.1:4175.

## Node 25 ломает внешние запросы backend

`backend/provider.mjs` импортирует npm-пакет `undici` 8, и тот подменяет глобальный диспетчер. На Node 25.8 (внутри undici 7.22) встроенный `fetch` после этого не распаковывает сжатые ответы: `content-encoding` пропадает, тело остаётся в brotli, `JSON.parse` падает. Видно как «Поиск адреса временно недоступен» (`/api/story-place` → 503), хотя Nominatim отвечает 200. На Node 24.20 (undici 7.29, как в контейнере на проде) ответ распаковывается. Проверено 2026-10-06.

## Выгрузка базы

`make db-dump` раньше писал снимок в `/tmp` контейнера генератора: это tmpfs на 64 МБ, а база весит ~420 МБ. `VACUUM INTO` падал и оставлял `/tmp` на проде заполненным на 100%. С 2026-10-06 снимок пишется в `/data` и удаляется при любом исходе (`scripts/prod-db.mjs`).
