# План: убрать встроенный тур главной и подсистему builtin-routes

Status: plan

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.

## Контекст

Второй из двух планов, согласованных пользователем 6 октября 2026 года. Первый ([перенос прогулки](2026-10-06-kozhevniki-zindel-to-catalog.md)) перевёл единственную встроенную прогулку `msk-kozhevniki-zindel-short` на места каталога и общую прогулку `?share=901d1133-44a2-4724-a856-2fe8d6c86a44`. Её тексты остались неиспользуемой копией в `public/data/routes/paveletskaya.json`, потому что от этого файла зависит главная страница.

## Найденные зависимости (6 октября 2026)

- `src/app/page.tsx` импортирует `paveletskaya.json` и передаёт его в `CatalogTour` → `TourExperience({ route })`. Без `walk` компонент работает в старом режиме: `AroundScreen` получает `route` (`walkChapterAt`, `openChapter`, `getWalkChapters`), после старта показывается `ClassicWalkView`; используются `usePlaybackProgress(route.id)`, `loadPublishedRoute` (`published-route-cache.ts`, `published-route.ts`), `firstPoi`.
- Бэкенд: `backend/builtin-routes.mjs` (генерирует `scripts/build-walk-catalog.mjs` в `pnpm build`), `walk-admin.mjs` (главы и озвучка встроенных прогулок, админская витрина), `walk-top.mjs`, `walk-nearby.mjs`, `favorite-summary.mjs`, `walk-feedback.mjs`, `walk-launch-routes.mjs`, `walk-view.mjs` (`storyRef.kind === "catalog"`), маршрут `/api/story-walks/<id>/view` и `/api/story-walks/<id>`.
- Фронтенд: `kind: "catalog"` в `walk-screen.tsx`, `walk-loader.ts`, `offline.ts`, `top-model.ts`, `reviews/model.ts`, `launches.ts`, `add-food-stop.ts`, `creation-location.ts`, `walks/adapters.ts` (`routeToWalkView`), админские `reviews-admin.tsx` и `improvements-admin.tsx`.
- Тесты, опирающиеся на реальную встроенную прогулку: `walk-catalog.test.mjs`, `server.test.mjs` (админская витрина прогулок, перенос), `walk-top-api.test.mjs`, `walk-reviews-api.test.mjs`, `walk-improvements-api.test.mjs`, `user-walks.test.mjs`, `walk-nearby.test.mjs`, фронтенд-тесты `top-walks`, `nearby-model`, `nearby-walks`, `adapters`.

## Открытые вопросы к пользователю

1. Что показывает главная без встроенного тура: только карту «Рядом» (старый режим удаляется) — проверить, нет ли пользователей с сохранённым прогрессом старого тура.
2. Оставлять ли `410 WALK_MOVED` для `?catalog=msk-kozhevniki-zindel-short` навсегда (старые ссылки, избранное, офлайн-копии) — тогда нужна минимальная таблица перенесённых ID вместо всего файла маршрута.
3. Исторические отзывы, запуски и улучшения с `kind: "catalog"` в базе аккаунтов: сохранить как есть или перенести на новую прогулку.
