# План: кофейни, кафе и перекус по пути прогулки

Status: in progress since 2026-10-04; phases 1–2 done; next: phase 3.

> Note for agents: this plan is a point-in-time snapshot — its "codebase facts" describe the code as of the date above and may be outdated. Do NOT treat it as current architecture docs; verify every fact against the actual code before relying on it.
>
> Заметка для агентов: план — снимок на дату выше. Перед правкой перепроверьте факты по актуальному коду.

## Цель

Человек на прогулке может быстро найти, где выпить кофе или поесть, не уходя далеко от маршрута:
открыть список заведений рядом с линией прогулки, увидеть их на карте, понять, открыто ли сейчас,
и вернуться к прогулке. Функция работает до старта прогулки, во время прогулки, на карте «Рядом»
и в офлайн-копии прогулки.

## Решения пользователя (04.10.2026)

- **Объём v1:** список + метки на карте + карточка заведения. Без фильтров по типу и кухне и без
  построения дороги до заведения через Valhalla.
- **Категории:** кофейни, кафе и рестораны, перекус, бары и пабы.
- **Где:** во время прогулки, до старта, на карте «Рядом», в офлайн-копии.
- **Радиус:** до 150 м от линии маршрута, по прямой.

## Вне объёма v1 (предложить отдельно, не делать без согласования)

- Фильтры по категории или кухне, сортировка по «открыто сейчас».
- Пешеходная дорога до заведения и обратно на маршрут (Valhalla).
- Кнопка «Заведение закрылось / данные неверны» (по аналогии с `place-feedback`).
- Цели Яндекс.Метрики на открытие списка.
- Автоматическое обновление индекса по расписанию (в v1 — ручная цель `make`).

## Фаза 0. Установленные факты (04.10.2026)

**Данные OSM.** PBF Москвы (BBBike, ODbL-1.0) уже используется локально:
`scripts/import-osm-attractions.py` (osmium, каталог мест) и `scripts/build-osm-address-index.py`
(SQLite с R-tree, атомарная замена файла, отчёт о пропусках, тест `scripts/test-build-osm-address-index.py`).
Сборка и выкладка описаны в `docs/agents/offline-osm-geocoding.md`. Новый индекс заведений
строится по тому же образцу и из того же PBF.

**Подложка карты.** `src/features/explore/map-style.ts:95`: векторные тайлы схемы Shortbread
(`/tiles/osm/{z}/{x}/{y}`), в слое `pois` есть `amenity`. Иконки туалетов и воды — слой стиля
`poi-amenity` (`map-style.ts:152`): MapLibre рисует их картинкой, на них нельзя нажать, часов работы
в тайлах нет. Поэтому заведения **не** добавляются в стиль подложки, а рисуются отдельными
метками Leaflet. Иконки — `src/features/explore/map-icons.ts` (`MAP_ICONS`, глифы Pinhead CC0,
рисуются на canvas, без спрайтов и без новых источников CSP).

**Загрузка по ячейкам — готовый образец.** `docs/agents/map-viewport-loading.md`:
- сервер: `backend/map-cells.mjs` (модель), `backend/http-cache.mjs` (ETag, 304, br/gzip, LRU),
  маршруты `backend/server.mjs:594-599` (`/api/content/map-cells`, строгая проверка пути, GET/HEAD);
- клиент: `src/features/explore/map-cells.ts` (`mapCellStore`: память → Cache Storage → условный запрос,
  ≤4 параллельных загрузки, объединение одинаковых запросов).

**Открытие SQLite-индекса на сервере.** `backend/server.mjs:786`:
`openOsmGeocoder(join(directory,"osm-addresses.sqlite"))`, закрытие при остановке — `server.mjs:725`.
Отсутствующий файл → функция выключена, повреждённый → явная ошибка запуска (`backend/osm-geocoder.mjs`).

**Прогулка.**
- `WalkDocument.route.geometry: Coordinates[]` (≤ 12 000 точек, ≤ 8 100 м) — `backend/walk-document.mjs:13,33,44`.
- Панель `src/features/tour/walk-session.tsx`: ящики `drawer: "stops" | "story" | "settings" | "reviews" | "position"`
  (`walk-session.tsx:106`), кнопки в футере (`:182-189`), ящик рисуется в `:191-207`.
  До старта и во время прогулки используется один компонент.
- Стадии `approach`/`stop` и подсвеченный участок — `walk-plan.tsx`, `route-legs.ts` (`routeLegCuts`).
  Там же лежат образцы проекции точки на линию маршрута.
- Карта: `src/features/explore/explore-map.tsx`, проп `items: MapItem[]` с `MarkerKind`
  (`place | stop | pending | endpoint | background`, `explore-map.tsx:135`); прочие слои — `route`, `routeActive`.
- Требования к раскладке панели: `docs/agents/walk-map-session.md` (футер с основным действием
  всегда виден; проверки `e2e/walk-session.spec.ts`, `layout-invariants` на 320×568, 360×640, 932×430).

**Карта «Рядом».** `src/features/explore/around-screen.tsx`, карточки — `around-sheets.tsx`.

**Офлайн-копия.** `src/features/walks/offline.ts`: Cache Storage `walk-packs-v1`, запись по стадиям
(`stage/pending.json` → манифест `OfflineWalkManifest`), лимит `MAX_PACK_BYTES` 60 МиБ.
Каталожные маршруты делят кеш через `published-route-cache.ts`.

**Часы работы.** Библиотеки для `opening_hours` в зависимостях нет. Популярная `opening_hours.js`
под LGPL-3.0 и весит сотни КБ. Решение: свой разбор распространённого подмножества; всё, что не
разобрано, честно показывается как «часы не указаны / см. на месте», без догадок.

**Ограничения, о которых нельзя забыть:**
- репозиторий публичный: в коммитах и заметках не должно быть адресов серверов, SSH и журналов выкладки;
- деплой только в фоне и только из чистой копии (см. память проекта и `docs/agents/production-deploy-concurrency.md`);
- атрибуция ODbL «© участники OpenStreetMap» обязательна там, где показываются данные заведений.

## Модель данных

Заведение (`FoodPlace`), одинаковое на сервере и клиенте:

```ts
type FoodKind = "coffee" | "cafe" | "restaurant" | "fast_food" | "bakery" | "bar";
type FoodPlace = {
  id: string;            // "osm:node:123" | "osm:way:456"
  kind: FoodKind;
  name: string;
  lat: number; lon: number;   // 5 знаков
  address: string | null;     // "Мясницкая улица, 24/7 с1"
  openingHours: string | null; // сырой тег opening_hours, разбирается на клиенте
  cuisine: string | null;      // сырой тег, показывается переведённым для известных значений
  website: string | null;      // только https?://
  phone: string | null;
};
```

Сопоставление тегов → `kind` (таблица, тестируется таблично):

| Теги OSM | kind | Группа в UI |
|---|---|---|
| `amenity=cafe` + `cuisine` содержит `coffee_shop`; `shop=coffee` с `drink:coffee` / без продажи зерна не включаем | `coffee` | Кофейни |
| `amenity=cafe` (прочее) | `cafe` | Кафе и рестораны |
| `amenity=restaurant` | `restaurant` | Кафе и рестораны |
| `amenity=fast_food`, `amenity=food_court`, `amenity=ice_cream` | `fast_food` | Перекус |
| `shop=bakery`, `shop=pastry` | `bakery` | Перекус |
| `amenity=bar`, `amenity=pub`, `amenity=biergarten` | `bar` | Бары и пабы |

Исключаются: объекты без `name`; `access=private|no`; префиксы жизненного цикла (`disused:`, `abandoned:`,
`was:`), `opening_hours="closed"|"off"`; дубли `node` внутри `way` с тем же именем и типом
(оставляем `node`). Для `way` и `relation` берётся репрезентативная точка (centroid, а если он вне
контура — точка на поверхности). Адресный импортер сохраняет контуры; вычисление
репрезентативной точки реализовано отдельно в `build-osm-food-index.py`.

## Фаза 1. Индекс заведений из PBF

**Что сделать.**
1. `scripts/build-osm-food-index.py` — **скопировать каркас** `scripts/build-osm-address-index.py`
   (разбор аргументов, osmium handler, временный файл рядом с целевым, атомарная замена,
   `PRAGMA integrity_check`, отчёт о пропусках). Выход — `backend/data/osm-food.sqlite`:
   - `places(id TEXT PK, kind, name, lat, lon, address, opening_hours, cuisine, website, phone)`;
   - `meta(key, value)`: `format_version=1`, `source_sha256`, `source_edited_at` (последнее редактирование
     включённых объектов), `built_at`, `counts_by_kind`.
2. Фильтрация и сопоставление `kind` — чистые функции, отдельно от osmium (как `duplicate_candidates`
   в `import-osm-attractions.py`), чтобы тесты не требовали PBF.
3. `scripts/test-build-osm-food-index.py` по образцу `test-build-osm-address-index.py`: таблица тегов → kind/исключение,
   нормализация сайта (только http/https), сборка адреса из `addr:street`+`addr:housenumber`,
   атомарность (при ошибке старый файл не тронут), неполная геометрия пропускается и считается в отчёте.
4. Цель `make osm-food PBF=...` в `Makefile` рядом с `osm-import`.
5. `backend/data/osm-food.sqlite` — в `.gitignore` (проверить, что `backend/data/*.sqlite` уже исключён).
6. Прогнать на текущем PBF, записать в заметку: число заведений по kind, размер файла, сколько
   с `opening_hours`. **По этим числам выбрать размер ячейки** для фазы 2: цель — сжатая ячейка в центре
   ≤ 100 КБ и маршрут на 8 км задевает ≤ 6 ячеек. Ожидаемый кандидат — 0,05° × 0,05°.

**Проверка.** `uv run ruff check . && uv run pyright && uv run pytest -q` (через `pnpm test:py`);
ручная сверка 5–10 известных кофеен в центре (есть, kind верный, точка у входа/в здании).

**Не делать.** Не тянуть заведения в `osm-attractions.json` и в таблицу `places` генератора —
это не истории и они не должны попасть в очередь генерации текстов. Не добавлять сетевые запросы
(Overpass, Nominatim) — только PBF.

**Итог фазы 1 (04.10.2026).** Снимок BBBike SHA-256 `e5dd9170…`, правки до 2026-10-02: 13 294 заведения
(coffee 1 881, cafe 3 083, restaurant 2 697, fast_food 3 878, bakery 590, bar 1 165), `opening_hours` у 57,8%,
индекс ≈ 2 МБ, 124 объекта пропущены по геометрии. Худшая ячейка: 0,02° — 439 мест, 17 КБ br, 8 ячеек на 8 км;
**0,05° — 1 641 место, 60 КБ br, 4 ячейки на 8 км (выбрано)**; 0,1° — 127 КБ br. `shop=coffee` не включается.
В часах встречается `24:00` и интервалы через полночь (`00:00-02:00,07:00-24:00`) — парсер фазы 3 обязан их понимать.

## Фаза 2. API ячеек заведений

**Что сделать.**
1. `backend/food-places.mjs`: `openFoodIndex(path)` по образцу `openOsmGeocoder`
   (read-only, проверка `format_version`, нет файла → `null`, несовместимый → ошибка запуска);
   `manifest()` и `cell(lat, lon)` — точки в ячейке, отсортированы по `id`; результаты сериализуются
   один раз и кешируются в памяти (индекс неизменяем до перезапуска).
2. Маршруты в `backend/server.mjs` рядом с `map-cells`, с той же строгой проверкой пути и
   `backend/http-cache.mjs` (ETag, 304, сжатие):
   - `GET /api/food/cells` → `{version:1, cellSize, sourceEditedAt, attribution, cells:[{lat,lon,count,etag}]}`;
   - `GET /api/food/cells/{latKey}/{lonKey}` → `{lat, lon, places: FoodPlace[]}`; ключ ячейки — целое
     `floor(coord * 20)`, чтобы не было дробей в URL.
   - Индекса нет → `503 {"error":"FOOD_INDEX_UNAVAILABLE"}` с `no-store`; клиент прячет функцию.
3. Подключение в `startServer` (`server.mjs:786`) и закрытие при остановке (`server.mjs:725`).
4. Тесты `backend/food-places.test.mjs` и HTTP-тесты по образцу `backend/map-cells.test.mjs` и
   `server.test.mjs`: границы ячеек (включая точку на границе), пустая ячейка, 400 на query-параметры,
   `-0`, ведущие нули, выход за диапазон; 304 по `If-None-Match`; 503 без индекса; несовместимая версия.

**Проверка.** `pnpm typecheck && node --test backend/food-places.test.mjs backend/server.test.mjs`;
`curl` по локальному `generator:dev` — манифест и одна ячейка центра, размер сжатого ответа.

**Не делать.** Не принимать геометрию маршрута в POST: клиент сам считает близость к линии, это
нужно и для офлайна, и для кеширования. Не добавлять отдельный кеш в nginx без замера.

**Phase 2 result (2026-10-04).** Read-only SQLite snapshot, cached camelCase cell bodies, shared ETags,
GET/HEAD, br/gzip and 304 are implemented. Missing index returns uncached 503 without preventing startup.
Nginx now preserves backend cache headers for `/api/food/`; compose routing needs no change.
Keys use multiplication (`floor(coord * 20)`) as approved by the reviewer, with map-cells-style clamping
at +90/+180 and ranges [-1800,1799]/[-3600,3599]. Occupied cells are serialized once;
the empty-cell cache is bounded to 128 entries to avoid unbounded allocation for arbitrary public requests.
Local curl: 94 cells, 13,294 places; manifest 7,301 bytes (2,351 br); center cell 1115/752
has 1,641 places, 364,145 bytes (60,790 br at shared cache quality 5). See `../food-places-api.md`.
Phase 0 correction for later work: `routeLegCuts` selects vertices, and `walk-plan.tsx` has no
point-to-segment projection helper; phase 3 must implement that calculation explicitly.

## Фаза 3. Ядро на клиенте: ячейки, близость к маршруту, часы работы

Новая папка `src/features/food/`.

1. `food-cells.ts` — хранилище ячеек. **Сначала оценить** вынос общего загрузчика из
   `src/features/explore/map-cells.ts` (память → Cache Storage → условный запрос, ограничение параллельности).
   Если общая часть больше ~60 строк — вынести её в `src/lib/geo/cell-store.ts` и перевести на неё
   `mapCellStore` без изменения поведения (его тесты должны пройти как есть). Иначе — скопировать образец.
   Кеш браузера — отдельный `food-cells-v1`.
2. `route-proximity.ts`:
   - `distanceToRoute(point, geometry)` → `{ distanceM, alongM, vertex }` — проекция на ближайший отрезок
     в локальной равнопромежуточной проекции (как в `route-legs.ts`);
   - `placesAlongRoute(places, geometry, { maxDistanceM: 150 })` → отсортированы по `alongM`;
     для петли (`mode: "loop"`) берётся самое раннее прохождение, как в `routeLegCuts`;
   - `cellsForRoute(geometry, cellSize, bufferM)` — какие ячейки нужны.
   - Подписи: «≈ N м от маршрута», «рядом с остановкой K» (ближайшая остановка по `alongM`).
     Минуты не показываем: расстояние по прямой, обещать время в пути нечестно.
3. `opening-hours.ts` — разбор подмножества тега и статус на момент `now` в `Europe/Moscow`
   (через `Intl.DateTimeFormat`, не через часовой пояс устройства):
   - поддержать: `24/7`; дни `Mo-Su`, списки и диапазоны (`Mo-Fr,Su`); интервалы `HH:MM-HH:MM`,
     несколько через запятую; переход за полночь (`10:00-02:00`); правила через `;` с перекрытием
     последним; `off`/`closed` для дней; `PH off` — игнорировать с пометкой «в праздники может отличаться»;
   - результат: `{ state: "open" | "closed" | "unknown", until?: "22:00", opensAt?: "Пн 09:00" }`;
   - всё прочее (`week`, `sunrise`, месяцы, комментарии) → `unknown`, без исключений.
   - Табличные тесты: каждое поддержанное правило, границы минут (ровно 22:00 — уже закрыто),
     ночные интервалы на стыке суток и недели, неразбираемые строки → `unknown`, `now` в другом поясе устройства.
4. `food-kinds.ts` — подписи групп и иконки. Иконки добавить в `MAP_ICONS` (`map-icons.ts`) глифами Pinhead
   (CC0): кофе, вилка-нож, бургер/булка, бокал. Цвета — через токены дизайна (`src/styles/tokens.css`),
   с контрастом WCAG AA к белому глифу.

**Проверка.** `pnpm vitest run src/features/food src/features/explore/map-cells.test.ts`; `pnpm typecheck`.

**Не делать.** Не подключать `opening_hours.js` и прочие зависимости без согласования. Не показывать
«Открыто», если статус `unknown`.

## Фаза 4. Заведения в прогулке (до старта и во время)

1. Новый ящик `"food"` в `WalkSession` (`walk-session.tsx:106`) и кнопка «Поесть рядом» в футере
   рядом с «Остановки» (иконка кофе). Кнопка показывается, только если манифест загружен и у маршрута
   есть геометрия. Учесть правило раскладки из `docs/agents/walk-map-session.md`: открытый ящик сжимается
   первым, футер с «Дальше»/«Завершить» остаётся на виду; кнопку на узких экранах сделать иконкой с
   `aria-label`, если подпись не помещается.
2. Содержимое ящика (`src/features/food/food-list.tsx`):
   - до старта — все заведения вдоль маршрута по порядку прохождения, сгруппированы «у остановки K»;
   - во время прогулки — сначала то, что впереди по текущему участку (`alongM` ≥ позиции текущего
     участка), затем пройденное свёрнутым списком «Позади»;
   - строка: иконка группы, название, «Открыто до 22:00» / «Закрыто, откроется в 9:00» / «Часы не указаны»,
     «≈ 80 м от маршрута»;
   - пустое состояние: «В 150 м от маршрута заведений нет по данным OpenStreetMap»;
   - внизу — «Данные OpenStreetMap на <дата>. Часы работы могут отличаться» и атрибуция.
3. Метки на карте: новый `MarkerKind` `"food"` в `explore-map.tsx` — меньше и спокойнее меток историй,
   не кластеризуются вместе с историями. Видны, только пока открыт ящик «Поесть рядом» или выбрана
   карточка заведения: во время прогулки карта не должна зашумляться.
4. Нажатие на строку или метку → карточка заведения в ящике: название, тип и кухня, статус часов и
   полная строка `opening_hours` под раскрытием, адрес, ссылки «Сайт» и «Позвонить» (`tel:`), если есть;
   кнопка «Назад к списку». Камера фокусируется на заведении вместе с ближайшей точкой маршрута
   (`fitTarget`), не сбивая подсветку участка.
5. Прогулку ничего не останавливает: аудио, геолокация и wake lock продолжают работать;
   закрытие ящика возвращает прежний вид.
6. Ошибки: сеть недоступна и нет кеша → строка «Не удалось загрузить заведения» с кнопкой «Повторить»
   (повтор с ограниченной экспоненциальной паузой — только для сетевых/5xx); 503 → кнопка не показывается.
7. Тесты: unit для сортировки «впереди/позади» и группировки по остановкам; `e2e/walk-food.spec.ts`
   с подставным API — список до старта, во время прогулки после «Дальше», метки появляются и исчезают,
   карточка, пустое состояние, ошибка и повтор, геометрия панели на 390×844, 1440×900, 568×400, 320×568
   (+ прогон `layout-invariants`).

**Проверка.** `pnpm check`, `pnpm test:e2e e2e/walk-food.spec.ts e2e/walk-session.spec.ts e2e/layout-invariants.spec.ts`;
ручной просмотр в браузере каталожной прогулки по Бульварному кольцу на телефоне (390×844).

**Не делать.** Не менять стадии `approach`/`stop` и логику срабатывания историй. Не добавлять метки
заведений в маршрутизатор и `walk-catalog`.

## Фаза 5. Карта «Рядом»

1. Кнопка-переключатель «Еда» в кнопках карты `MapShell` на экране `around-screen.tsx`. Состояние
   запоминается в `localStorage` (с try/catch, без него всё работает).
2. При включении — заведения в видимой области при масштабе ≥ 15 (на меньшем — подсказка «Приблизьте карту»);
   ячейки по `onViewport` через `food-cells.ts`.
3. Нажатие на метку → карточка заведения в `around-sheets.tsx` (тот же компонент карточки, что в фазе 4),
   с расстоянием от текущей позиции, если она известна.
4. Тесты: unit для выбора видимых заведений; e2e — переключатель, порог масштаба, карточка, сохранение
   состояния после перезагрузки.

**Проверка.** `pnpm check`; e2e `around`-сценарии и `layout-invariants`.

## Фаза 6. Офлайн-копия

1. `saveWalkOffline` (`src/features/walks/offline.ts:107`): после аудио сохранить ячейки заведений,
   которые задевает маршрут (`cellsForRoute`), в ту же стадию пакета; в `OfflineWalkManifest` добавить
   необязательное поле `food: { sourceEditedAt, cells: [{key, etag, bytes}] }` (старые манифесты остаются
   валидными). Учитывать байты в `MAX_PACK_BYTES`.
2. Ошибка загрузки заведений **не срывает** сохранение прогулки: пакет сохраняется без них, а интерфейс
   офлайн-копии пишет «Заведения не сохранены».
3. При открытии офлайн-копии `food-cells.ts` сначала смотрит пакет прогулки. Статус часов считается
   локально, дата данных показывается.
4. Каталожные маршруты (`published-route-cache.ts`) — так же, если они сохраняются отдельно.
5. Тесты по образцу `src/features/walks/offline.test.ts`: пакет с заведениями, без них (старый манифест),
   ошибка загрузки ячейки, удаление пакета удаляет и ячейки.

**Проверка.** `pnpm vitest run src/features/walks src/features/food`; e2e: сохранить прогулку,
перейти в офлайн (`context.setOffline(true)`), открыть ящик «Поесть рядом».

## Фаза 7. Выкладка, документация, финальная проверка

1. Документация: `docs/agents/food-places.md` (данные, сопоставление тегов, размер ячейки и замеры,
   поддержанное подмножество `opening_hours`, процесс обновления индекса, ограничения) и строка в
   `docs/agents/README.md`. В `README.md` — раздел для пользователя о новой функции (по-русски).
2. Финальная проверка анти-паттернов:
   - `grep -rn "opening_hours.js\|overpass\|nominatim" src backend` — пусто;
   - заведения не попадают в `places`/очередь генерации (`grep -n "osm-food" backend/*.mjs` — только `food-places.mjs` и `server.mjs`);
   - нет «Открыто» при `unknown` (тест);
   - атрибуция OSM видна в списке и карточке.
3. `pnpm check` и полный `pnpm test:e2e`. Падения `layout-invariants`, которые есть и на базовом коммите,
   отметить отдельно.
4. Коммиты атомарные по фазам (`feat(food): …`).
5. **Выкладка — только после подтверждения пользователя:** собрать индекс из того же PBF, что у Valhalla,
   загрузить `osm-food.sqlite` в `DATA_DIR` атомарно (как `osm-addresses.sqlite`), выложить backend и фронтенд
   из чистой копии в фоне, перед этим проверить свежие резервные копии (параллельные выкладки).
   После выкладки: `GET /api/food/cells` → 200, ячейка центра, проверка на телефоне по каталожной прогулке.
   В заметку — без адресов серверов и деталей доступа.

## Риски

- **Устаревание данных.** OSM по заведениям обновляется быстрее, чем мы пересобираем индекс. Смягчение —
  дата данных в интерфейсе и цель `make osm-food`; регулярное обновление предложить отдельно.
- **Неполные часы работы.** Значительная доля заведений без `opening_hours` или со сложными правилами —
  показываем `unknown`, не угадываем. Долю замерить в фазе 1.
- **Перегруз панели на маленьких экранах.** Ещё одна кнопка в футере — риск повторить дефекты обрезания
  из `docs/agents/production-main-2026-10-02.md`; проверка `layout-invariants` обязательна в фазе 4.
- **Размер ячеек в центре.** Если сжатая ячейка > 100 КБ — уменьшить `cellSize`, а не урезать поля.
