// Сценарий и хронометраж ролика «Красная площадь и Варварка». Модуль общий для
// страницы-сцены (браузер) и скрипта рендера (Node), поэтому без зависимостей.

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
/** Доля такта: 120 уд/мин, склейки и акценты стоят на ударах. */
export const BEAT = 0.5;

/**
 * Сцены в секундах. Меняйте хронометраж только здесь: музыка строится по нему.
 * hook — собор собирается из фигур; ask — вопрос; map — маршрут по карте; facts —
 * четыре факта с этого маршрута; player — экран истории; board — табло обещаний; brand — знак.
 */
export const SCENES = Object.freeze([
  {id: "hook", start: 0, end: 4},
  {id: "ask", start: 4, end: 6},
  {id: "map", start: 6, end: 19},
  {id: "facts", start: 19, end: 29},
  {id: "player", start: 29, end: 42.5},
  {id: "board", start: 42.5, end: 45.5},
  {id: "brand", start: 45.5, end: 49.5},
]);

/**
 * Линия маршрута рисуется в сцене map с MAP_DRAW.from по MAP_DRAW.to (секунды от начала
 * сцены) — около секунды на остановку; после неё камера отъезжает на общий план со счётчиками.
 */
export const MAP_DRAW = Object.freeze({from: 0.9, to: 10.9});

export const DURATION = SCENES.at(-1).end;
export const FRAME_COUNT = Math.round(DURATION * FPS);

/**
 * Факты для карточек. `stop` — номер остановки (с нуля), `evidence` — фрагменты,
 * которые обязаны встречаться в опубликованной истории этой остановки: так подписи
 * не разойдутся с текстом на сайте.
 */
export const FACTS = Object.freeze([
  {stop: 0, value: "0", unit: "км", caption: ["Отсюда отсчитывают", "дороги из столицы"], evidence: ["начальную точку отсчёта дорожных расстояний"]},
  {stop: 5, value: "1561", unit: "", caption: ["Дату окончания стройки", "нашли под шатром в 1958-м"], evidence: ["12 июля 1561 года", "В 1958 году в основании шатра"]},
  {stop: 7, value: "1556", unit: "", caption: ["Иван Грозный дарит двор", "английским купцам"], evidence: ["В 1556 году Иван Грозный подарил двор", "Московской компании"]},
  {stop: 9, value: "8", unit: "м", caption: ["истории под ногами:", "культурный слой Зарядья"], evidence: ["толщиной до восьми метров"]},
]);

/**
 * Остановка, чью историю «играет» телефон, и озвучка: `text` — фраза на экране (дословно из
 * истории или её заголовок), `speech` — то, что читает диктор (годы словами: так их не
 * исказит нормализатор TTS). Клипы звучат подряд с паузой VOICE_GAP; историю не дочитывают
 * до конца — голос уходит в затухание на склейке с табло (VOICE_FADE).
 */
export const PLAYER = Object.freeze({
  stop: 5,
  narration: Object.freeze([
    // Первый клип читает заголовок истории, он и подсвечивается на экране.
    {id: "title", text: "Собор Василия Блаженного", speech: "Собор Василия Блаженного."},
    {
      id: "nine",
      text: "Его композицию образуют девять самостоятельных столпообразных церквей, объединённых галереями.",
      speech: "Его композицию образуют девять самостоятельных столпообразных церквей, объединённых галереями.",
    },
    {
      id: "tenth",
      text: "В 1588 году над захоронением Василия Блаженного к собору пристроили отдельную церковь.",
      speech: "В тысяча пятьсот восемьдесят восьмом году над захоронением Василия Блаженного к собору пристроили отдельную церковь.",
    },
  ]),
});

/** С какой секунды сцены player звучит голос (после нажатия «play») и паузы между клипами. */
export const VOICE_AT = 1.2;
export const VOICE_GAP = 0.35;
/** Голос затихает за столько секунд до конца сцены player. */
export const VOICE_FADE = 0.8;

/** Строки табло; каждая строка встаёт на удар. */
export const BOARD = Object.freeze(["БЕЗ ЭКСКУРСОВОДА", "БЕЗ РАСПИСАНИЯ", "В СВОЁМ ТЕМПЕ"]);

/**
 * @param {string} id
 */
export function scene(id) {
  const found = SCENES.find((item) => item.id === id);
  if (!found) throw new RangeError(`Нет сцены ${id}`);
  return found;
}

/** Длина одной карточки факта. */
export const FACT_LENGTH = (scene("facts").end - scene("facts").start) / FACTS.length;
/** Шаг строк табло. */
export const BOARD_STEP = 0.75;

/**
 * Партитура музыки: склейки, смены карточек, удары колоколов, стук табло.
 * @returns {{seconds: number, beat: number, groove: number, drive: [number, number], cuts: number[], hits: number[], bells: number[], ticks: number[], duck: [number, number], finale: number}}
 */
export function musicScore() {
  const facts = scene("facts");
  const hook = scene("hook");
  const board = scene("board");
  return {
    seconds: DURATION,
    beat: BEAT,
    groove: scene("ask").start,
    drive: [scene("map").start, scene("player").start],
    cuts: SCENES.slice(1).map(({start}) => start),
    hits: FACTS.slice(1).map((_, index) => facts.start + (index + 1) * FACT_LENGTH),
    // Колокола — на куполах собора, которые появляются в первой сцене.
    bells: [hook.start + 1.0, hook.start + 1.5, hook.start + 2.0, hook.start + 2.5],
    ticks: BOARD.map((_, index) => board.start + 0.1 + index * BOARD_STEP),
    duck: [scene("player").start, scene("player").end],
    finale: scene("brand").start,
  };
}

/**
 * Камера карты: точка карты (cx, cy) встаёт в (ox, oy) экрана, карта наклонена
 * на tilt градусов (верх уходит вдаль) и увеличена в zoom раз. Та же матрица, что у
 * CSS `perspective` + `rotateX`, поэтому HTML-метки совпадают с картой.
 * @typedef {{cx: number, cy: number, zoom: number, tilt: number, ox: number, oy: number, perspective: number}} Camera
 */

/** CSS-трансформация контейнера карты (transform-origin: 0 0). */
export function cameraTransform({cx, cy, zoom, tilt, ox, oy}) {
  return `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) rotateX(${tilt.toFixed(3)}deg) scale(${zoom.toFixed(4)}) translate(${(-cx).toFixed(2)}px, ${(-cy).toFixed(2)}px)`;
}

/**
 * Экранные координаты точки карты и масштаб глубины (1 — на уровне центра).
 * @param {Camera} camera
 * @param {{x: number, y: number}} point
 */
export function cameraProject({cx, cy, zoom, tilt, ox, oy, perspective}, {x, y}) {
  const angle = (tilt * Math.PI) / 180;
  const localX = (x - cx) * zoom;
  const localY = (y - cy) * zoom;
  const depth = localY * Math.sin(angle);
  if (depth >= perspective) throw new RangeError("Точка карты оказалась за камерой");
  const scale = perspective / (perspective - depth);
  return {x: ox + localX * scale, y: oy + localY * Math.cos(angle) * scale, scale};
}

/**
 * Сколько букв диктор произносит в слове экрана: число «1588» звучит как «тысяча пятьсот
 * восемьдесят восьмом» — около девяти букв на цифру.
 * @param {string} word
 */
export function spokenLength(word) {
  const digits = word.replace(/\D/g, "").length;
  return word.length - digits + digits * 9;
}

/**
 * Время появления слов при чтении: доля отрезка пропорциональна произносимой длине слова.
 * @param {string[]} words
 * @returns {number[]} начало каждого слова
 */
export function wordTimes(words, from, to) {
  if (!(to > from) || words.length === 0) throw new RangeError("Нужны слова и отрезок положительной длины");
  const weights = words.map((word) => spokenLength(word) + 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let passed = 0;
  return weights.map((weight) => {
    const at = from + ((to - from) * passed) / total;
    passed += weight;
    return at;
  });
}

/**
 * Расписание озвучки в секундах от начала сцены player. Клипы TTS начинаются и кончаются
 * тишиной разной длины, поэтому ставим встык именно речь: `lead` — где в клипе начинается
 * голос, `speech` — сколько он звучит.
 * @param {{id: string, lead: number, speech: number}[]} clips
 * @returns {{id: string, at: number, from: number, to: number}[]} at — старт файла клипа, from/to — речь
 */
export function voiceSchedule(clips, {at = VOICE_AT, gap = VOICE_GAP} = {}) {
  let cursor = at;
  return clips.map(({id, lead, speech}) => {
    if (!(speech > 0) || !(lead >= 0) || lead > cursor) throw new RangeError(`Клип «${id}» не встаёт в расписание`);
    const item = {id, at: cursor - lead, from: cursor, to: cursor + speech};
    cursor = item.to + gap;
    return item;
  });
}
