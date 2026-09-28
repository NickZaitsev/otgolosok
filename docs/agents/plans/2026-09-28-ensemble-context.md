# План: рассказы об объектах в составе ансамбля

Status: planned 2026-09-28

> Заметка для агентов: план — снимок на дату выше. Факты о коде ниже проверены 28.09.2026,
> но перед правкой перепроверьте их по актуальному коду.

## Контекст

Пилот `enrich` (партия `ac2a4c4d`, 30 мест, 14 `ready`) остановил два места с
`INSUFFICIENT_EVIDENCE`, хотя модель определила их верно:

| Место | OSM | Факт идентичности (object) | Фактов об окружении (site_context) |
|---|---|---|---|
| Стела «Битва за Ленинград; Курская битва» | `osm:node:4693848375` | «На Аллее славы в южной части Карельского бульвара установлена памятная стела…» | 7 (Аллея славы: 2018, пять стел, обелиск, пушки Д-44…) |
| Мишка с мячом | `osm:node:4142950214` | «„Мишка с мячом“ — скульптура в парке искусств „Музеон“» | 7 (история «Музеона» с 1991 года, реконструкция 2013 года…) |

Данные взяты из `checkpoint.factsRejection` production-базы 28.09.2026. Отдельного факта о самом
объекте (автор, дата, материал) в источниках нет. `restrictWeakIdentityEvidence` оставляет только
факты `subjectRelation=object` и требует среди них `kind=content`, поэтому оба места остановлены.

**Решение пользователя (28.09.2026):**

- разрешить факты об окружении для weak_identity-места, если объект подтверждён и
  страницы прямо называют ансамбль, в который он входит;
- каждая точка получает свой текст: сначала сам объект, потом история ансамбля;
- в одну прогулку попадает не больше одной точки ансамбля.

Общий рассказ на весь ансамбль и новая сущность «ансамбль» в модели данных **не делаются**.

## Фаза 0. Установленные факты о коде (28.09.2026)

Конвейер — `runContentJob` в `backend/content-pipeline.mjs` (около строк 80–110):

1. Поиск → `checkpoint.research`, загрузка страниц → `checkpoint.sources`.
2. Факты: `requestStructured(provider, factsPrompt(anchor, sources, context))`, затем
   `raw = {...facts.value, addressConfirmed, resolvedAddress, placeName}`,
   `validateFacts(raw, sources, {requireEditorialScope:true, identityMode:"place"})`, для
   `job.identityPolicy === "weak_identity"` — `restrictWeakIdentityEvidence(evidence, job.place)`.
   Если здесь выброшено исключение, в checkpoint сохраняется `factsRejection` (функция `factsRejection`,
   около строки 55). Если исключения нет, результат пишется в `checkpoint.evidence`.
3. `writeStory(checkpoint.evidence, {…, address, placeIdentified})` (`backend/story-writing.mjs`)
   использует `draftPrompt` и `reviewPrompt` из `backend/prompts.mjs`.
4. `store.completeContentJob` (`backend/content-store.mjs:386`) пишет `place_texts.evidence_json`.

`validateFacts` (`backend/domain.mjs`, около строки 64):

- принимает `subjectRelation` из `object | site_context | nearby`;
- копирует в результат только известные поля: `version`, `identityNote`, `addressConfirmed`, `placeName`,
  `resolvedAddress`, `facts`, `sources`. **Новое поле из ответа модели само не пройдёт**, его нужно
  добавить явно;
- проверка цитаты: `comparable(source.text).includes(comparable(proof.quote))`, длина 18–500 символов.
  Функция `comparable` не экспортируется. Для проверки цитаты ансамбля экспортируйте её или вынесите
  проверку цитаты в общую функцию и не дублируйте.

`restrictWeakIdentityEvidence` (`backend/identity-triage.mjs:123`):

```js
const facts = evidence.facts.filter(fact => fact.subjectRelation === "object");
const named = facts.some(fact => fact.kind === "identity" && fact.evidence.some(proof => quoteNamesPlace(proof.quote, place)));
if (!named) throw failure("IDENTITY_UNCONFIRMED");
if (!facts.some(fact => fact.kind === "content")) throw failure("INSUFFICIENT_EVIDENCE");
```

`quoteNamesPlace(quote, place)` (`identity-triage.mjs:104`) принимает `{name, tags}`. Её можно
переиспользовать для проверки, что цитата называет ансамбль: `quoteNamesPlace(quote, {name: ensembleName, tags: {}})`.
`identityNameKey(name)` (`identity-triage.mjs:16`) нормализует название в ключ.

`checkpoint.locationContext.district` = `{osmId, name, relation}` из офлайн-индекса
(`backend/osm-geocoder.mjs:93`), у стелы и «Мишки» он есть.

Прогулки:

- `store.listWalkCandidates` (`backend/content-store.mjs:198`) возвращает
  `{id, address, location, readiness}`. Одобренный текст берётся подзапросом по `place_texts`
  (`approved_story_json IS NOT NULL`, последний по `created_at, rowid`).
- `backend/walks.mjs:285` проверяет каждый элемент `supplied` строго (`contentId`, `clean`, `inBox`, `readinessRank`).
- Кандидаты собираются в `addCandidate` (`walks.mjs:292`), цепочка без финиша — `selectChain`
  (`walks.mjs:56`), с финишем — `alongRoute` и дальнейший цикл (`walks.mjs:309`).
- Заметка `docs/agents/walk-routing-selection.md` описывает правила отбора; её нужно дополнить.

`EDITORIAL_EVIDENCE_VERSION = 2` (`backend/domain.mjs:4`). Новое необязательное поле evidence его
**не повышает**. Повышение сбросило бы evidence всех незавершённых заданий.

Повтор задания: `store.retryBatchItem(batchId, placeId, {restartFrom:"auto"})`. У
`INSUFFICIENT_EVIDENCE` из шага фактов нет `evidence`, поэтому шаг фактов повторится на уже
загруженных источниках без нового поиска.

Команды проверки: `npm run lint`, `npm run typecheck`, `npm test`, перед коммитом `npm run check`.

### Запреты для всех фаз

- Не менять `assessPlaceEligibility`, уровни триажа, `quoteNamesPlace` для самого объекта.
- Не ослаблять правила для обычной политики (`standard`) и адресного конвейера (`backend/pipeline.mjs`).
- Не принимать факты `nearby` как замену фактам об ансамбле.
- Не повышать `EDITORIAL_EVIDENCE_VERSION`.
- Не заводить таблицу ансамблей и общий рассказ ансамбля.
- Не запускать повторы на production без явного подтверждения пользователя.

## Фаза 1. Ансамбль в ответе модели и evidence

**Что сделать.**

1. `factsPrompt` (только при `placeContext`): добавить поле ответа
   `"ensemble":null|{"name":"…","evidence":[{"sourceId":"s1","quote":"EXACT excerpt"}]}` и правило:
   заполнять, только если страницы прямо говорят, что этот объект — часть названного целого
   (аллея, мемориальный комплекс, парк скульптур, усадебный ансамбль). Цитата должна содержать название
   ансамбля. Улица, район и здание, в котором стоит объект, ансамблем не считаются.
2. `backend/domain.mjs`: новая экспортируемая функция `validateEnsemble(value, sources)` →
   `{name, evidence:[{sourceId, quote}]} | null`:
   - `name` — непустая строка длиной не больше 160 символов;
   - не больше 2 цитат, каждая проходит ту же проверку точной цитаты, что в `validateFacts`;
   - хотя бы одна цитата проходит `quoteNamesPlace(quote, {name, tags:{}})`. Если импорт из
     `identity-triage.mjs` создаёт цикл, проверку названия делайте в фазе 2, внутри `restrictWeakIdentityEvidence`;
   - невалидный ансамбль → `null`, без исключения: ансамбль необязателен.
3. `validateFacts` в режиме `identityMode:"place"` копирует в результат
   `ensemble: validateEnsemble(result.ensemble, sources)`, только если результат не `null`.
   Источники из цитат ансамбля попадают в `used`.
4. `runContentJob`: после `validateFacts` дописать в `evidence.ensemble` ключ
   `key = \`${district.osmId}:${identityNameKey(name)}\``, где `district = checkpoint.locationContext?.district`.
   Без района ключ — `name:${identityNameKey(name)}`. Ключ нужен только для прогулок.
5. `factsRejection` сохраняет и `ensemble` (с обрезкой как у фактов), чтобы редактор видел ответ модели.

**Образцы.** Проверка цитаты — тело `validateFacts` (`domain.mjs`, фильтр `evidence`). Табличные
тесты правил — `backend/editorial-evidence.test.mjs`. Тесты промпта — поиск по `factsPrompt` в
`backend/content-pipeline.test.mjs`.

**Проверка (таблица в `editorial-evidence.test.mjs`).**

| ensemble в ответе | Ожидание |
|---|---|
| отсутствует или `null` | в evidence нет `ensemble` |
| имя + точная цитата с именем | `ensemble` с этой цитатой |
| имя + цитата не со страницы | нет `ensemble`, остальное evidence как без него |
| имя + точная цитата без имени ансамбля | нет `ensemble` |
| имя длиннее 160 символов или пустое | нет `ensemble` |
| 5 цитат | не больше 2 |

- Тест `runContentJob`: `ensemble.key` содержит `osmId` района из `locationContext`, а без района — префикс `name:`.
- `identityMode:"address"` (адресный конвейер) поле `ensemble` не возвращает.

## Фаза 2. Правило weak_identity и тексты

**Что сделать.**

1. `restrictWeakIdentityEvidence`: если в `evidence.ensemble` есть ансамбль,
   - сохраняются факты `object` и не больше 4 фактов `site_context` с `kind=content` (в порядке ответа модели);
   - требование `IDENTITY_UNCONFIRMED` не меняется: нужен факт идентичности об объекте, цитата которого
     называет объект (`quoteNamesPlace`);
   - `INSUFFICIENT_EVIDENCE` — только когда нет ни одного факта `content` среди оставшихся;
   - без ансамбля поведение как сейчас.
   Обоснование лимита 4: текст должен оставаться рассказом у объекта, а не путеводителем по ансамблю.
2. `draftPrompt`: если в evidence есть `ensemble`, передавать `ensemble.name` в FACTS и добавить правило:
   «Начни с самого объекта по фактам subjectRelation=object. Затем прямо скажи, что он часть ансамбля
   <name>, и расскажи об ансамбле. Не приписывай объекту даты, авторов и события ансамбля».
3. `reviewPrompt`: при наличии `ensemble` добавить к списку отклонений «факт site_context подан как факт об
   объекте». Передавать `ensemble.name` в данных проверки.
4. `placeIdentified` и адресные правила не меняются.

**Проверка.**

- Таблица в `backend/identity-triage.test.mjs`:

| identity об объекте с названием | ensemble | content object | content site_context | Ожидание |
|---|---|---|---|---|
| есть | нет | 0 | 3 | `INSUFFICIENT_EVIDENCE` (как сейчас) |
| есть | есть | 0 | 3 | evidence: 1 object + 3 site_context |
| есть | есть | 0 | 7 | site_context обрезаны до 4 |
| есть | есть | 1 | 2 | 1 + 1 + 2 |
| нет | есть | 0 | 3 | `IDENTITY_UNCONFIRMED` |
| есть | есть | 0 | 0 | `INSUFFICIENT_EVIDENCE` |
| есть | есть, факт `nearby` | 0 | 0 (+2 nearby) | `INSUFFICIENT_EVIDENCE` |

- Тест `runContentJob` с провайдером-заглушкой на данных стелы (identity + site_context + ensemble
  «Аллея славы»): задание `ready`, в `draftPrompt` ушло название ансамбля, в `reviewPrompt` — правило про
  site_context.
- Тест: обычная политика (`standard`) с тем же ответом даёт тот же evidence, что до изменения, кроме поля `ensemble`.

## Фаза 3. Одна точка ансамбля в прогулке

**Что сделать.**

1. `listWalkCandidates`: добавить в подзапрос одобренного текста
   `json_extract(evidence_json,'$.ensemble.key')` из той же строки `place_texts` и вернуть
   `ensembleKey` (строка или отсутствует).
2. `walks.mjs`: при проверке `supplied` принимать необязательный `ensembleKey` — строку длиной
   1–200 символов, иначе `unavailable()`. Прокинуть `ensembleKey` в `addCandidate`.
3. Отбор: кандидат пропускается, если в уже выбранных остановках есть тот же `ensembleKey`:
   - в `selectChain` — вместе с проверкой `chain.includes`;
   - в ветке с финишем — при формировании `alongRoute` (оставлять лучший по текущей сортировке)
     и в последующем цикле добавления.
   Точка без `ensembleKey` ведёт себя как сейчас. Ручные прогулки (`manual`) не трогать.
4. Дополнить `docs/agents/walk-routing-selection.md` одним абзацем о правиле.

**Проверка (`backend/walks.test.mjs`, `backend/content-store.test.mjs`).**

- Две точки с одним `ensembleKey` рядом → в прогулку без финиша попала одна, с лучшим `contentRank`.
- То же для прогулки с финишем, обе точки на линии маршрута.
- Одинаковое название ансамбля в разных районах (разные ключи) → обе точки допустимы.
- Точки без `ensembleKey` — существующие тесты проходят без изменений.
- `ensembleKey` неверного типа от `candidateProvider` → `WALK_UNAVAILABLE`, как и для других полей.
- `listWalkCandidates` возвращает `ensembleKey` только из одобренного текста.

## Фаза 4. Проверка, выкладка, повтор

1. `npm run check` без ошибок. Grep-проверки:
   - `grep -n "EDITORIAL_EVIDENCE_VERSION *=" backend/domain.mjs` — всё ещё `2`;
   - `grep -n "subjectRelation === \"object\"" backend/identity-triage.mjs` — фильтр для места без ансамбля на месте.
2. Коммиты по фазам (`feat(content): …`, `feat(walks): …`), выкладка в фоне
   (`make deploy-otgolosok-generator` из репозитория инфраструктуры `~/projects/utils/services`).
3. **После подтверждения пользователя** — повтор с `restartFrom:"auto"` в партии `ac2a4c4d`:
   стела (`osm:node:4693848375`) и «Мишка с мячом» (`osm:node:4142950214`). Ожидание: оба `ready`.
   Прочитать оба текста: объект назван первым, история ансамбля не приписана объекту.
   У «Мишки» цитата идентичности взята с форума babyblog.ru. Отметьте это редактору при утверждении.
4. Выгрузить остальные `INSUFFICIENT_EVIDENCE` обоих пилотов с `site_context`-фактами в `factsRejection`
   и предложить пользователю список для повтора, не запуская его.
5. Дописать итог в `docs/agents/weak-identity-triage.md` (раздел о пилоте enrich) и поставить в плане
   `Status: done` с датой.

## Риски

- Модель может называть «ансамблем» улицу или район. Защита: правило в промпте, цитата с названием,
  лимит 4 факта, проверка на `site_context`, поданный как факт об объекте.
- Если у модели нет стабильного названия ансамбля, одинаковые ансамбли получат разные ключи
  («Аллея славы» и «Аллея Славы защитникам Отечества»). В худшем случае в прогулку попадут две точки,
  то есть будет как сейчас. Дедупликацию по совпадению части названия без данных не делаем.
- Тексты точек одного ансамбля будут похожи между собой. По решению пользователя это допустимо,
  потому что в одну прогулку попадает только одна такая точка.
