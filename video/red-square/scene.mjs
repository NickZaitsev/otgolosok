// Рекламный ролик «Красная площадь и Варварка»: собор собирается из фигур, факты с
// маршрута, маршрут по наклонённой карте, экран истории, табло и знак.
// Вся анимация — чистая функция времени `seek(t)`, без CSS-переходов и таймеров.
// Кадры листает scripts/render-red-square-video.mjs через scripts/lib/frame-render.mjs.
import {
  BOARD, BOARD_STEP, FACTS, FACT_LENGTH, FPS, HEIGHT, PLAYER, SCENES, WIDTH,
  cameraProject, cameraTransform, scene, wordTimes,
} from "/timeline.mjs";
import {clamp, ease, hash, lerp, polyline, progress, spring, stripesPolygon} from "/shared/motion.mjs";
import {attr, charLine, css, echoLine, el, grainLayer, requireFonts, revealChars, rings, updateEcho, updateRings} from "/shared/dom.mjs";

const stage = document.getElementById("stage");

const response = await fetch("/walk.json");
if (!response.ok) throw new Error(`Нет данных ролика: ${response.status}`);
/** @type {{title: string, attribution: string, distanceM: number, walkMin: number, stops: {label: string, x: number, y: number}[], route: [number, number][], layers: {water: string, parks: string, walls: string, major: string, minor: string, buildings: {d: string, c: [number, number]}[]}}} */
const data = await response.json();

// Озвучка сцены player: расписание клипов (секунды от начала сцены) и громкость голоса по кадрам.
// Файл собирает скрипт рендера из video/red-square/voice/.
const voiceResponse = await fetch("/voice.json");
if (!voiceResponse.ok) throw new Error(`Нет данных озвучки: ${voiceResponse.status}`);
/** @type {{schedule: {id: string, at: number, from: number, to: number}[], levels: number[]}} */
const voice = await voiceResponse.json();

const COLORS = {deep: "#0d1714", green: "#203e38", paper: "#f5f1e8", cream: "#fffefa", ink: "#1a1714", rust: "#b64b28", coral: "#ff7a5c", peach: "#f5b296", sage: "#9fbfb1", gold: "#e8b04b"};

function sceneRoot(id, background) {
  return el("section", {cls: "scene", parent: stage, attrs: {"data-scene": id}, style: {background}});
}

/** Момент, когда монотонная функция времени впервые достигает значения. */
function timeWhen(fn, target, from, to) {
  let low = from;
  let high = to;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (fn(middle) >= target) high = middle;
    else low = middle;
  }
  return high;
}

/** Центр узла в координатах сцены по раскладке, без учёта CSS-трансформаций. */
function layoutCenter(node) {
  let x = node.offsetWidth / 2;
  let y = node.offsetHeight / 2;
  for (let current = node; current && current !== stage; current = current.offsetParent) {
    x += current.offsetLeft;
    y += current.offsetTop;
  }
  return {x, y};
}

function mixColor(from, to, amount) {
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const [a, b] = [parse(from), parse(to)];
  return `rgb(${a.map((value, index) => Math.round(lerp(value, b[index], clamp(amount)))).join(",")})`;
}

// ---------- Собор из фигур (сцена 1 и обложка на экране телефона) ----------

/** Луковичная глава: основание шириной 0,6w на высоте by, острие на by − h. */
function onionPath(cx, by, w, h) {
  const p = (dx, dy) => `${(cx + dx * w).toFixed(1)} ${(by - dy * h).toFixed(1)}`;
  return `M${p(-0.3, 0)}C${p(-0.62, 0.15)} ${p(-0.62, 0.5)} ${p(-0.3, 0.68)}C${p(-0.12, 0.8)} ${p(0, 0.86)} ${p(0, 1)}` +
    `C${p(0, 0.86)} ${p(0.12, 0.8)} ${p(0.3, 0.68)}C${p(0.62, 0.5)} ${p(0.62, 0.15)} ${p(0.3, 0)}Z`;
}

/**
 * Стилизованный Покровский собор: галерея, пять барабанов, шатёр и главы с полосами.
 * update(t) собирает его по времени от начала сборки; t = Infinity — готовый.
 */
function cathedral(parent, prefix, {width = 1080, style} = {}) {
  const svg = el("svg:svg", {parent, attrs: {viewBox: "0 0 1080 1100", width, height: (width * 1100) / 1080}, style});
  const defs = el("svg:defs", {parent: svg});
  const stripes = (id, a, b, angle, size = 26) => {
    const pattern = el("svg:pattern", {parent: defs, attrs: {id: `${prefix}-${id}`, width: size, height: size, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${angle})`}});
    el("svg:rect", {parent: pattern, attrs: {width: size, height: size, fill: a}});
    el("svg:rect", {parent: pattern, attrs: {width: size / 2, height: size, fill: b}});
    return pattern;
  };
  const checker = (id, a, b, size = 30) => {
    const pattern = el("svg:pattern", {parent: defs, attrs: {id: `${prefix}-${id}`, width: size, height: size, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"}});
    el("svg:rect", {parent: pattern, attrs: {width: size, height: size, fill: a}});
    el("svg:rect", {parent: pattern, attrs: {width: size / 2, height: size / 2, fill: b}});
    el("svg:rect", {parent: pattern, attrs: {x: size / 2, y: size / 2, width: size / 2, height: size / 2, fill: b}});
    return pattern;
  };
  const patterns = [
    stripes("a", COLORS.green, COLORS.cream, 35),
    stripes("b", COLORS.rust, COLORS.gold, -35),
    stripes("c", COLORS.sage, COLORS.green, 55, 22),
    checker("d", COLORS.peach, COLORS.green),
    stripes("tent", COLORS.rust, COLORS.cream, 0, 34),
    stripes("brick", "#c8583a", COLORS.rust, 90, 20),
  ];
  const fill = (id) => `url(#${prefix}-${id})`;
  const ground = 1000;

  const groundLine = el("svg:rect", {parent: svg, attrs: {x: 40, y: ground, width: 1000, height: 6, rx: 3, fill: COLORS.peach}});
  // Галерея с арками и кокошниками.
  const gallery = el("svg:g", {parent: svg});
  el("svg:rect", {parent: gallery, attrs: {x: 130, y: 800, width: 820, height: 200, fill: fill("brick")}});
  el("svg:rect", {parent: gallery, attrs: {x: 130, y: 790, width: 820, height: 22, fill: COLORS.cream}});
  for (let index = 0; index < 7; index += 1) {
    const x = 175 + index * 110;
    el("svg:path", {parent: gallery, attrs: {d: `M${x} ${ground}V900A35 35 0 0 1 ${x + 70} 900V${ground}Z`, fill: COLORS.deep}});
  }
  for (let index = 0; index < 9; index += 1) {
    const x = 150 + index * 88;
    el("svg:path", {parent: gallery, attrs: {d: `M${x} 792A40 40 0 0 1 ${x + 80} 792Z`, fill: COLORS.cream}});
  }

  // Барабаны: [x, ширина, верх, узор, глава: ширина, высота, момент появления главы].
  const towers = [
    {x: 480, w: 120, top: 430, body: fill("brick"), dome: null, at: 0},
    {x: 250, w: 100, top: 560, body: COLORS.cream, dome: {w: 170, h: 200, fill: fill("a")}, at: 0.5},
    {x: 730, w: 100, top: 560, body: COLORS.cream, dome: {w: 170, h: 200, fill: fill("b")}, at: 0.5},
    {x: 370, w: 80, top: 630, body: COLORS.peach, dome: {w: 128, h: 150, fill: fill("c")}, at: 1.0},
    {x: 630, w: 80, top: 630, body: COLORS.peach, dome: {w: 128, h: 150, fill: fill("d")}, at: 1.5},
  ].map((tower, index) => {
    const group = el("svg:g", {parent: svg});
    el("svg:rect", {parent: group, attrs: {x: tower.x, y: tower.top, width: tower.w, height: 800 - tower.top, fill: tower.body}});
    for (let band = tower.top + 40; band < 780; band += 70) {
      el("svg:rect", {parent: group, attrs: {x: tower.x, y: band, width: tower.w, height: 10, fill: COLORS.rust, opacity: 0.55}});
    }
    let dome = null;
    if (tower.dome) {
      const cx = tower.x + tower.w / 2;
      dome = el("svg:g", {parent: svg});
      el("svg:rect", {parent: dome, attrs: {x: cx - tower.dome.w * 0.34, y: tower.top - 14, width: tower.dome.w * 0.68, height: 18, rx: 6, fill: COLORS.gold}});
      el("svg:path", {parent: dome, attrs: {d: onionPath(cx, tower.top - 10, tower.dome.w, tower.dome.h), fill: tower.dome.fill}});
      const tip = tower.top - 10 - tower.dome.h;
      el("svg:path", {parent: dome, attrs: {d: `M${cx} ${tip}V${tip - 56}M${cx - 18} ${tip - 38}H${cx + 18}`, stroke: COLORS.gold, "stroke-width": 7, "stroke-linecap": "round"}});
    }
    return {...tower, group, dome, delay: index * 0.15};
  });
  // Центральный шатёр с малой главкой.
  const tent = el("svg:g", {parent: svg});
  el("svg:path", {parent: tent, attrs: {d: "M470 432L540 200L610 432Z", fill: fill("tent")}});
  el("svg:rect", {parent: tent, attrs: {x: 520, y: 180, width: 40, height: 26, fill: COLORS.cream}});
  const crown = el("svg:g", {parent: svg});
  el("svg:path", {parent: crown, attrs: {d: onionPath(540, 184, 76, 96), fill: COLORS.gold}});
  el("svg:path", {parent: crown, attrs: {d: "M540 88V30M522 50H558", stroke: COLORS.gold, "stroke-width": 7, "stroke-linecap": "round"}});

  const scaleAt = (node, x, y, sx, sy = sx) => attr(node, {transform: `translate(${x} ${y}) scale(${Math.max(0, sx).toFixed(4)} ${Math.max(0, sy).toFixed(4)}) translate(${-x} ${-y})`});

  /** @param {number} t секунды от начала сборки; купола — на 1,0 / 1,5 / 2,0 / 2,5 с. */
  function update(t) {
    scaleAt(groundLine, 540, ground, progress(t, 0, 0.7), 1);
    const rise = progress(t, 0.1, 0.8);
    attr(gallery, {transform: `translate(0 ${((1 - rise) * 260).toFixed(1)})`, opacity: rise.toFixed(3)});
    for (const tower of towers) {
      scaleAt(tower.group, tower.x + tower.w / 2, 800, 1, progress(t, 0.35 + tower.delay, 0.95 + tower.delay));
      if (tower.dome) {
        const pop = spring(t - 1.0 - tower.at, {frequency: 2.2, damping: 6.5});
        scaleAt(tower.dome, tower.x + tower.w / 2, tower.top, pop);
      }
    }
    scaleAt(tent, 540, 432, 1, progress(t, 0.6, 1.0));
    scaleAt(crown, 540, 190, spring(t - 1.0, {frequency: 2.4, damping: 6}));
    // Полосы глав бегут по кругу, как роспись на вращающемся куполе.
    patterns.slice(0, 4).forEach((pattern, index) => {
      const angle = [35, -35, 55, 45][index];
      attr(pattern, {patternTransform: `rotate(${angle}) translate(${((t * 26 * (index % 2 ? -1 : 1)) % 52).toFixed(2)} 0)`});
    });
  }
  return {svg, update};
}

// ---------- Сцена 1: «Вы проходили здесь сто раз» ----------

const DOME_POINT = {x: 540, y: 980};

const hook = (() => {
  const {start, end} = scene("hook");
  const root = sceneRoot("hook", "var(--deep)");
  const layer = el("div", {cls: "fill", parent: root, style: {transformOrigin: `${DOME_POINT.x}px ${DOME_POINT.y}px`}});
  const dots = el("svg:svg", {cls: "fill", parent: layer, attrs: {viewBox: "0 0 1080 1920"}});
  const dotList = [];
  for (let row = 0; row < 24; row += 1) {
    for (let column = 0; column < 14; column += 1) {
      dotList.push({node: el("svg:circle", {parent: dots, attrs: {cx: 40 + column * 77, cy: 40 + row * 80, r: 2.4, fill: COLORS.sage, opacity: 0}}), seed: hash(row * 31 + column)});
    }
  }
  const building = cathedral(layer, "hook", {style: {position: "absolute", left: "0", top: "820px"}});
  const kicker = el("div", {cls: "abs center-x kicker", parent: layer, text: "Москва · Красная площадь", style: {top: "250px", color: "var(--sage)"}});
  const text = el("div", {cls: "abs center-x", parent: layer, style: {top: "330px"}});
  const lineA = charLine(text, "Вы проходили здесь", {style: {font: "700 76px/1.1 var(--sans)", color: "var(--cream)", letterSpacing: "-1px"}});
  const lineB = echoLine(text, "сто раз.", {cls: "serif italic", style: {fontSize: "236px", color: "var(--peach)", marginTop: "10px"}, ghostColor: "var(--peach)"});

  return {root, start, end, tail: 0.6, update(time) {
    const local = time - start;
    dotList.forEach(({node, seed}) => attr(node, {opacity: (progress(local, seed * 0.8, seed * 0.8 + 0.6, ease.linear) * 0.35).toFixed(3)}));
    building.update(local);
    css(kicker, {opacity: progress(local, 0.1, 0.7), letterSpacing: `${lerp(26, 8, progress(local, 0.1, 1.4)).toFixed(2)}px`});
    revealChars(lineA.chars, local, 0.2, {step: 0.03});
    revealChars(lineB.chars, local, 0.8, {step: 0.06, length: 0.7});
    const beat = local > 1.5 ? Math.max(0, 1 - ((local - 1.5) % 0.5) / 0.5) ** 3 : 0;
    updateEcho(lineB, local, 0.8, {spread: 56, pulse: beat * 0.6});
    // Наезд в главу перед склейкой.
    const dive = progress(local, 3.2, 4.6, ease.inQuart);
    css(layer, {transform: `scale(${(1 + dive * 2.6).toFixed(4)})`, filter: dive > 0 ? `blur(${(dive * 6).toFixed(2)}px)` : "none"});
  }};
})();

// ---------- Сцена 2: «А вы слышали, что здесь было?» ----------

const ask = (() => {
  const {start, end} = scene("ask");
  const root = sceneRoot("ask", "var(--rust)");
  const ringList = rings(root, 6, {color: "rgba(255, 254, 250, 0.45)", width: 3});
  const text = el("div", {cls: "abs center-x", parent: root, style: {top: "600px"}});
  const lead = charLine(text, "А вы слышали,", {style: {font: "800 70px/1.1 var(--sans)", color: "var(--cream)", letterSpacing: "-1px"}});
  const big = el("div", {parent: text, style: {marginTop: "30px"}});
  const bigA = charLine(big, "что здесь", {cls: "serif italic", style: {fontSize: "220px", color: "var(--cream)"}});
  const bigB = charLine(big, "было?", {cls: "serif italic", style: {fontSize: "220px", color: "var(--ink)"}});
  const wave = el("svg:svg", {cls: "abs", parent: root, attrs: {viewBox: "0 0 1080 300", width: 1080, height: 300}, style: {left: "0", top: "1380px"}});
  const waves = [0.9, 0.55, 0.3].map((opacity, index) => el("svg:path", {parent: wave, attrs: {fill: "none", stroke: index ? COLORS.peach : COLORS.cream, "stroke-width": 7 - index * 2, "stroke-linecap": "round", opacity}}));

  return {root, start, end, tail: 0.5, update(time) {
    const local = time - start;
    const radius = progress(local, 0, 0.55, ease.swing) * 2300;
    css(root, {clipPath: local < 0.55 ? `circle(${radius.toFixed(1)}px at ${DOME_POINT.x}px ${DOME_POINT.y}px)` : "none"});
    updateRings(ringList, local, {x: 540, y: 960, from: 0.2, every: 0.3, life: 1.5, size: 1700});
    revealChars(lead.chars, local, 0.2, {step: 0.025});
    revealChars(bigA.chars, local, 0.4, {step: 0.045, length: 0.55});
    revealChars(bigB.chars, local, 0.7, {step: 0.05, length: 0.55});
    const amplitude = progress(local, 0.3, 1.0) * (0.8 + 0.2 * Math.sin(local * 9));
    waves.forEach((path, index) => {
      const points = [];
      for (let x = 0; x <= 1080; x += 12) {
        const envelope = Math.sin((Math.PI * x) / 1080) ** 2;
        const y = 150 + envelope * amplitude * 110 * (Math.sin(x / 38 + local * 11 + index) * 0.6 + Math.sin(x / 17 - local * 7 + index * 2) * 0.4) * (1 - index * 0.25);
        points.push(`${x} ${y.toFixed(1)}`);
      }
      attr(path, {d: `M${points.join("L")}`});
    });
  }};
})();

// ---------- Сцена 3: факты с маршрута ----------

const PALETTES = [
  {bg: COLORS.cream, fg: COLORS.ink, accent: COLORS.rust, soft: "#efe6d6"},
  {bg: COLORS.green, fg: COLORS.cream, accent: COLORS.peach, soft: "#28493f"},
  {bg: COLORS.peach, fg: COLORS.ink, accent: COLORS.green, soft: "#f0a386"},
  {bg: COLORS.sage, fg: COLORS.ink, accent: COLORS.rust, soft: "#8fb0a2"},
];

const facts = (() => {
  const {start, end} = scene("facts");
  const root = sceneRoot("facts", "transparent");
  const cards = FACTS.map((fact, index) => {
    const palette = PALETTES[index % PALETTES.length];
    const stop = data.stops[fact.stop];
    const card = el("div", {cls: "card", parent: root, style: {background: palette.bg, color: palette.fg}});
    const deco = el("svg:svg", {cls: "fill", parent: card, attrs: {viewBox: "0 0 1080 1920"}});
    const blob = el("svg:circle", {parent: deco, attrs: {cx: 540, cy: 860, r: 360, fill: palette.soft}});
    const dash = el("svg:circle", {parent: deco, attrs: {cx: 540, cy: 860, r: 450, fill: "none", stroke: palette.accent, "stroke-width": 4, "stroke-dasharray": "3 22", "stroke-linecap": "round"}});
    const kicker = el("div", {cls: "abs center-x kicker", parent: card, text: "Факты с маршрута", style: {top: "200px", opacity: "0.7"}});
    const tagWrap = el("div", {cls: "abs center-x", parent: card, style: {top: "290px"}});
    const tag = el("div", {cls: "tag", parent: tagWrap, style: {background: palette.fg, color: palette.bg}});
    el("b", {parent: tag, text: String(fact.stop + 1), style: {background: palette.accent, color: palette.bg === COLORS.peach ? COLORS.cream : palette.bg}});
    el("span", {parent: tag, text: stop.label});
    const odometer = el("div", {cls: "abs center-x odometer", parent: card, style: {top: "680px", color: palette.fg}});
    const digits = Array.from(fact.value, (char) => {
      const column = el("span", {cls: "digit", parent: odometer});
      const strip = el("span", {cls: "strip", parent: column});
      for (let turn = 0; turn < 2; turn += 1) for (let digit = 0; digit < 10; digit += 1) el("span", {parent: strip, text: String(digit)});
      return {strip, target: 10 + Number(char)};
    });
    const unit = fact.unit ? el("span", {cls: "unit", parent: odometer, text: fact.unit, style: {color: palette.accent}}) : null;
    const caption = el("div", {cls: "abs center-x caption", parent: card, style: {top: "1330px"}});
    const lines = fact.caption.map((text) => charLine(caption, text));
    const pager = el("div", {cls: "abs pager", parent: card, style: {left: "0", right: "0", top: "1700px", justifyContent: "center"}});
    const bars = FACTS.map(() => el("i", {parent: pager, style: {background: palette.fg}}));
    return {card, blob, dash, kicker, tag, odometer, digits, unit, lines, bars, palette, index};
  });

  return {root, start, end, tail: 0.6, update(time) {
    cards.forEach((item, index) => {
      const from = start + index * FACT_LENGTH;
      const local = time - from;
      const covered = index + 1 < cards.length && time >= from + FACT_LENGTH + 0.32;
      const visible = local >= 0 && !covered;
      css(item.card, {visibility: visible ? "visible" : "hidden", zIndex: index});
      if (!visible) return;
      // Диагональная шторка: треугольник от левого нижнего угла накрывает прошлую карточку.
      const wipe = progress(local, 0, 0.32, ease.swing);
      const reach = (wipe * 260).toFixed(2);
      css(item.card, {clipPath: wipe < 1 ? `polygon(0% 100%, 0% ${(100 - Number(reach)).toFixed(2)}%, ${reach}% 100%)` : "none"});
      const grow = spring(local - 0.05, {frequency: 1.6, damping: 6});
      attr(item.blob, {r: (360 * grow).toFixed(1)});
      attr(item.dash, {transform: `rotate(${(local * 40).toFixed(2)} 540 860)`, r: (430 + 30 * progress(local, 0, 1.5)).toFixed(1)});
      css(item.kicker, {transform: `translateY(${((1 - progress(local, 0.05, 0.5)) * -30).toFixed(1)}px)`});
      css(item.tag, {transform: `translateX(${((1 - progress(local, 0.08, 0.6)) * -700).toFixed(1)}px)`});
      // Медленный наезд на число, пока карточка на экране.
      css(item.odometer, {transform: `scale(${(1 + 0.06 * progress(local, 0.2, FACT_LENGTH, ease.outCubic)).toFixed(4)})`});
      item.digits.forEach(({strip, target}, order) => {
        const roll = target * progress(local, 0.15 + order * 0.1, 1.45 + order * 0.1);
        css(strip, {transform: `translateY(${(-roll).toFixed(4)}em)`});
      });
      if (item.unit) css(item.unit, {transform: `scale(${spring(local - 1.2, {frequency: 2.2, damping: 6.5}).toFixed(4)})`, transformOrigin: "0 100%"});
      item.lines.forEach(({chars}, order) => revealChars(chars, local, 0.7 + order * 0.2, {step: 0.018, length: 0.55}));
      item.bars.forEach((bar, order) => css(bar, {opacity: order === index ? 1 : order < index ? 0.55 : 0.2, transform: `scaleX(${order === index ? progress(local, 0, FACT_LENGTH, ease.linear) * 0.6 + 0.4 : 1})`, transformOrigin: "0 50%"}));
    });
  }};
})();

// ---------- Сцена 4: маршрут по карте ----------

const map = (() => {
  const {start, end} = scene("map");
  const root = sceneRoot("map", "var(--deep)");
  const view = el("div", {parent: root, attrs: {id: "map-view"}});
  const cam = el("div", {parent: view, attrs: {id: "map-cam"}});
  const svg = el("svg:svg", {parent: cam, attrs: {viewBox: `0 0 ${data.view.width} ${data.view.height}`, width: data.view.width, height: data.view.height}});
  const {layers} = data;
  el("svg:rect", {parent: svg, attrs: {x: -600, y: -600, width: data.view.width + 1200, height: data.view.height + 1200, fill: COLORS.deep}});
  el("svg:path", {parent: svg, attrs: {d: layers.water, fill: "#17414a"}});
  el("svg:path", {parent: svg, attrs: {d: layers.parks, fill: "#18322a"}});
  el("svg:path", {parent: svg, attrs: {d: layers.minor, fill: "none", stroke: "#1f322c", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round"}});
  el("svg:path", {parent: svg, attrs: {d: layers.major, fill: "none", stroke: "#2a423b", "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round"}});
  const route = polyline(data.route.map(([x, y]) => ({x, y})));
  const houses = layers.buildings.map(({d, c}) => {
    const node = el("svg:path", {parent: svg, attrs: {d, fill: "#243f39", stroke: "#2e4d46", "stroke-width": 0.8}});
    const center = {x: c[0], y: c[1]};
    const share = route.shareNear(center);
    const near = route.at(share);
    return {node, center, share, distance: Math.hypot(near.x - center.x, near.y - center.y)};
  });
  el("svg:path", {parent: svg, attrs: {d: layers.walls, fill: "none", stroke: COLORS.rust, "stroke-width": 4, opacity: 0.8}});
  const routeD = `M${data.route.map(([x, y]) => `${x} ${y}`).join("L")}`;
  const glow = el("svg:path", {parent: svg, attrs: {d: routeD, fill: "none", stroke: COLORS.peach, "stroke-width": 22, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.22, pathLength: 1, "stroke-dasharray": "1 1"}});
  const line = el("svg:path", {parent: svg, attrs: {d: routeD, fill: "none", stroke: COLORS.coral, "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: 1, "stroke-dasharray": "1 1"}});
  const head = el("svg:circle", {parent: svg, attrs: {r: 11, fill: COLORS.cream, stroke: COLORS.coral, "stroke-width": 5}});
  const headRing = el("svg:circle", {parent: svg, attrs: {r: 11, fill: "none", stroke: COLORS.coral, "stroke-width": 3}});

  const pins = data.stops.map((stop, index) => ({...stop, node: el("div", {cls: "pin", parent: root, text: String(index + 1)}), share: route.shareNear(stop)}));

  // Заголовок и нижние карточки поверх карты.
  el("div", {parent: root, style: {position: "absolute", left: "0", right: "0", top: "0", height: "620px", background: "linear-gradient(var(--deep) 45%, rgba(13, 23, 20, 0))"}});
  el("div", {parent: root, style: {position: "absolute", left: "0", right: "0", bottom: "0", height: "520px", background: "linear-gradient(rgba(13, 23, 20, 0), var(--deep) 60%)"}});
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: "Прогулка в центре", style: {top: "190px", color: "var(--sage)"}});
  const title = el("div", {cls: "abs center-x serif", parent: root, style: {top: "250px", fontSize: "120px", color: "var(--cream)"}});
  const titleA = charLine(title, "Красная площадь");
  const titleB = charLine(title, "и Варварка", {cls: "italic", style: {color: "var(--peach)"}});
  const card = el("div", {cls: "stop-card", parent: root, style: {top: "1560px"}});
  const rows = data.stops.map((stop, index) => {
    const row = el("div", {cls: "stop-row", parent: card});
    el("b", {parent: row, text: String(index + 1)});
    el("span", {parent: row, text: stop.label});
    return row;
  });
  const stats = el("div", {cls: "abs stats", parent: root, style: {left: "60px", right: "60px", top: "1530px"}});
  const km = (data.distanceM / 1000).toFixed(1).replace(".", ",");
  const statList = [
    {value: Number(km.replace(",", ".")), format: (value) => value.toFixed(1).replace(".", ","), label: "км пешком"},
    {value: data.stops.length, format: (value) => String(Math.round(value)), label: "историй"},
    {value: data.walkMin, format: (value) => String(Math.round(value)), label: "мин ходьбы"},
  ].map((item) => {
    const box = el("div", {cls: "stat", parent: stats});
    return {...item, box, number: el("strong", {parent: box}), caption: el("span", {parent: box, text: item.label})};
  });

  const drawFrom = 0.9;
  const drawTo = 5.0;
  const headShare = (local) => progress(local, drawFrom, drawTo, ease.swing);
  const reachTimes = pins.map((pin) => timeWhen(headShare, pin.share - 0.002, drawFrom, drawTo));
  houses.forEach((house) => { house.litAt = house.distance < 42 ? timeWhen(headShare, house.share, drawFrom, drawTo) : Infinity; });
  const origin = data.stops[0];
  const spanX = Math.max(...data.route.map(([x]) => x)) - Math.min(...data.route.map(([x]) => x));
  const overview = {
    cx: (Math.max(...data.route.map(([x]) => x)) + Math.min(...data.route.map(([x]) => x))) / 2,
    cy: (Math.max(...data.route.map(([, y]) => y)) + Math.min(...data.route.map(([, y]) => y))) / 2,
    zoom: 900 / spanX, tilt: 24, oy: 1060,
  };
  /** Цель камеры сглажена: среднее по отрезку пути позади головы, без рывков на зигзагах. */
  const follow = (share) => {
    let x = 0;
    let y = 0;
    for (let sample = 0; sample < 9; sample += 1) {
      const point = route.at(clamp(share - 0.1 + sample * 0.0125));
      x += point.x;
      y += point.y;
    }
    return {x: x / 9, y: y / 9};
  };

  function camera(local) {
    const share = headShare(local);
    const target = local < drawFrom ? origin : follow(share);
    const intro = progress(local, 0, drawFrom + 0.6, ease.outCubic);
    const blend = progress(local, 5.0, 6.2, ease.swing);
    const settle = local < drawFrom ? {x: lerp(origin.x, target.x, intro), y: lerp(origin.y, target.y, intro)} : target;
    return {
      cx: lerp(settle.x, overview.cx, blend),
      cy: lerp(settle.y, overview.cy, blend),
      zoom: lerp(lerp(2.3, 1.8, intro), overview.zoom, blend),
      tilt: lerp(lerp(62, 50, intro), overview.tilt, blend),
      ox: 540,
      oy: lerp(1120, overview.oy, blend),
      perspective: 2200,
    };
  }

  let housesSettled = false;
  return {root, start, end, tail: 0.4, update(time) {
    const local = time - start;
    // Вход полосами-жалюзи поверх вопроса.
    const wipe = Array.from({length: 12}, (_, band) => progress(local, band * 0.025, 0.36 + band * 0.025, ease.swing));
    css(root, {clipPath: wipe.every((value) => value >= 1) ? "none" : stripesPolygon(wipe)});
    const view3d = camera(local);
    css(view, {perspective: `${view3d.perspective}px`, perspectiveOrigin: `${view3d.ox}px ${view3d.oy.toFixed(1)}px`});
    css(cam, {transform: cameraTransform(view3d)});

    // Здания вырастают волной от первой остановки и подсвечиваются, когда мимо проходит маршрут.
    if (!housesSettled || local < 2.4) {
      houses.forEach((house) => {
        const delay = Math.hypot(house.center.x - origin.x, house.center.y - origin.y) / 900;
        const grow = local < delay ? 0 : spring(local - delay, {frequency: 1.8, damping: 7});
        attr(house.node, {transform: `translate(${house.center.x} ${house.center.y}) scale(${Math.max(0, grow).toFixed(3)}) translate(${-house.center.x} ${-house.center.y})`});
      });
      housesSettled = local >= 2.4;
    }
    houses.forEach((house) => {
      if (house.litAt === Infinity) return;
      attr(house.node, {fill: mixColor("#243f39", "#4a7a69", progress(local, house.litAt, house.litAt + 0.5))});
    });

    const share = headShare(local);
    attr(line, {"stroke-dashoffset": (1 - share).toFixed(5)});
    attr(glow, {"stroke-dashoffset": (1 - share).toFixed(5)});
    const tip = route.at(share);
    const drawing = local >= drawFrom;
    attr(head, {cx: tip.x.toFixed(2), cy: tip.y.toFixed(2), opacity: drawing ? 1 : 0});
    const pulse = ((local * 1.6) % 1);
    attr(headRing, {cx: tip.x.toFixed(2), cy: tip.y.toFixed(2), r: (11 + pulse * 34).toFixed(2), opacity: drawing ? ((1 - pulse) * 0.9).toFixed(3) : 0});

    pins.forEach((pin, index) => {
      const shown = spring(local - reachTimes[index], {frequency: 2.4, damping: 6.5});
      const point = cameraProject(view3d, pin);
      const depth = clamp(point.scale, 0.55, 1.4);
      css(pin.node, {transform: `translate(${point.x.toFixed(1)}px, ${(point.y - 40 * depth * shown).toFixed(1)}px) scale(${(shown * depth).toFixed(4)})`, opacity: shown > 0.01 ? 1 : 0});
    });

    css(kicker, {opacity: progress(local, 0.3, 0.9)});
    revealChars(titleA.chars, local, 0.35, {step: 0.025});
    revealChars(titleB.chars, local, 0.55, {step: 0.03});

    // Карточка текущей остановки: новая въезжает снизу, прошлая уходит вверх.
    const cardShown = progress(local, drawFrom, drawFrom + 0.4) * (1 - progress(local, 5.0, 5.4));
    css(card, {opacity: cardShown.toFixed(3), transform: `translateY(${((1 - cardShown) * 60).toFixed(1)}px)`});
    rows.forEach((row, index) => {
      const enter = progress(local, reachTimes[index], reachTimes[index] + 0.3);
      const leave = index + 1 < rows.length ? progress(local, reachTimes[index + 1], reachTimes[index + 1] + 0.3) : 0;
      css(row, {transform: `translateY(${((1 - enter) * 100 - leave * 100).toFixed(2)}%)`, opacity: enter > 0 && leave < 1 ? 1 : 0});
    });
    statList.forEach((stat, index) => {
      const at = 5.3 + index * 0.15;
      const shown = progress(local, at, at + 0.5);
      stat.number.textContent = stat.format(stat.value * progress(local, at, at + 1.0, ease.outCubic));
      css(stat.box, {opacity: shown.toFixed(3), transform: `translateY(${((1 - shown) * 50).toFixed(1)}px)`});
    });
  }};
})();

// ---------- Сцена 5: экран истории ----------

const player = (() => {
  const {start, end} = scene("player");
  const root = sceneRoot("player", "var(--green)");
  const ringList = rings(root, 5, {color: "rgba(159, 191, 177, 0.35)", width: 2});
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: `${data.stops.length} остановок — ${data.stops.length} историй`, style: {top: "150px", color: "var(--sage)"}});
  const head = el("div", {cls: "abs center-x serif italic", parent: root, style: {top: "205px", fontSize: "118px", color: "var(--cream)"}});
  const headLine = charLine(head, "Слушайте на месте");
  const phone = el("div", {cls: "phone", parent: root, style: {left: "200px", top: "440px", width: "680px", height: "1380px"}});
  const screen = el("div", {cls: "screen", parent: phone});
  el("div", {cls: "island", parent: screen});
  const cover = el("div", {cls: "cover", parent: screen});
  const coverArt = cathedral(cover, "cover", {width: 440, style: {position: "absolute", left: "66px", top: "-16px"}});
  coverArt.update(Infinity);
  const coverRings = rings(cover, 3, {color: "rgba(245, 178, 150, 0.6)", width: 3});
  const body = el("div", {parent: screen, style: {position: "absolute", left: "50px", right: "50px", top: "510px"}});
  el("div", {cls: "chip", parent: body, text: `Остановка ${PLAYER.stop + 1} из ${data.stops.length}`});
  const heading = el("div", {cls: "serif", parent: body, style: {fontSize: "64px", marginTop: "22px", lineHeight: "1"}});
  const words = el("div", {cls: "words", parent: body, style: {marginTop: "26px"}});
  /** Слова каждой реплики с моментами начала: заголовок подсвечивается первым клипом. */
  const lines = PLAYER.narration.map((line, lineIndex) => {
    const slot = voice.schedule[lineIndex];
    if (slot?.id !== line.id) throw new Error(`Расписание озвучки не совпадает с репликой «${line.id}»`);
    const parent = lineIndex === 0 ? heading : words;
    const list = line.text.split(" ");
    const nodes = list.map((word, index) => {
      const node = el("span", {parent, text: word});
      if (index < list.length - 1 || (lineIndex > 0 && lineIndex < PLAYER.narration.length - 1)) parent.appendChild(document.createTextNode(" "));
      return node;
    });
    return {nodes, starts: wordTimes(list, slot.from, slot.to), end: slot.to};
  });
  const wave = el("div", {cls: "wave", parent: screen, style: {position: "absolute", left: "50px", right: "220px", bottom: "92px"}});
  const bars = Array.from({length: 26}, () => el("i", {parent: wave}));
  const play = el("div", {cls: "play", parent: screen, style: {right: "50px", bottom: "60px"}});
  const icon = el("svg:svg", {parent: play, attrs: {viewBox: "0 0 24 24"}});
  const triangle = el("svg:path", {parent: icon, attrs: {d: "M8 5.5v13l10.5-6.5z", fill: COLORS.cream}});
  const pause = el("svg:path", {parent: icon, attrs: {d: "M7 5h3.6v14H7zM13.4 5H17v14h-3.6z", fill: COLORS.cream}});
  const tapRing = el("div", {cls: "ring", parent: screen, style: {borderColor: COLORS.rust, borderWidth: "4px", opacity: "0"}});
  const tapAt = 0.9;
  // Центр кнопки на экране 644×1344: right 50, bottom 60, диаметр 132.
  const PLAY_CENTER = {x: 644 - 50 - 66, y: 1344 - 60 - 66};

  return {root, start, end, tail: 0, update(time) {
    const local = time - start;
    const lift = progress(local, 0, 0.6, ease.swing);
    css(root, {clipPath: lift < 1 ? `inset(${((1 - lift) * 100).toFixed(2)}% 0 0 0 round 80px 80px 0 0)` : "none"});
    updateRings(ringList, local, {x: 540, y: 1100, from: 0.5, every: 0.9, life: 3.2, size: 2000});
    css(kicker, {opacity: progress(local, 0.3, 0.8)});
    revealChars(headLine.chars, local, 0.35, {step: 0.025});
    const enter = progress(local, 0.15, 1.0);
    const sway = Math.sin(local * 1.3) * 1.2;
    // Пока звучит голос, телефон медленно наезжает на зрителя.
    const push = 1 + 0.04 * progress(local, 1, end - start, ease.linear);
    css(phone, {transform: `translateY(${((1 - enter) * 700).toFixed(1)}px) scale(${push.toFixed(4)}) rotate(${((1 - enter) * -10 + sway * 0.4).toFixed(3)}deg) perspective(2000px) rotateY(${((1 - enter) * 18 + sway).toFixed(3)}deg)`});
    const playing = local >= tapAt;
    const press = local >= tapAt && local < tapAt + 0.25 ? 1 - Math.abs((local - tapAt) / 0.125 - 1) : 0;
    css(play, {transform: `scale(${(1 - press * 0.12).toFixed(4)})`});
    attr(triangle, {opacity: playing ? 0 : 1});
    attr(pause, {opacity: playing ? 1 : 0});
    const ripple = (local - tapAt) / 0.7;
    if (ripple > 0 && ripple < 1) {
      const size = 132 + ripple * 260;
      css(tapRing, {left: `${(PLAY_CENTER.x - size / 2).toFixed(1)}px`, top: `${(PLAY_CENTER.y - size / 2).toFixed(1)}px`, width: `${size.toFixed(1)}px`, height: `${size.toFixed(1)}px`, opacity: ((1 - ripple) * 0.8).toFixed(3)});
    } else css(tapRing, {opacity: 0});
    updateRings(coverRings, playing ? local : -1, {x: 286, y: 190, from: tapAt, every: 0.7, life: 2.0, size: 700});
    for (const {nodes, starts, end: lineEnd} of lines) {
      nodes.forEach((node, index) => {
        const lit = progress(local, starts[index], starts[index] + 0.18, ease.linear);
        const next = index + 1 < starts.length ? starts[index + 1] : lineEnd;
        const current = local >= starts[index] && local < next;
        css(node, {color: mixColor("#b8ad9e", COLORS.ink, lit), background: current ? "rgba(245, 178, 150, 0.7)" : "transparent"});
      });
    }
    // Эквалайзер — громкость настоящего голоса: полоса i показывает кадр на i шагов назад.
    const frame = Math.round(local * FPS);
    bars.forEach((bar, index) => {
      const level = voice.levels[frame - index * 2] ?? 0;
      const energy = playing ? 0.12 + 0.88 * level * (0.75 + 0.25 * hash(index)) : 0.12;
      css(bar, {height: `${(10 + energy * 60).toFixed(1)}px`, opacity: playing ? 1 : 0.5});
    });
  }};
})();

// ---------- Сцена 6: табло ----------

/** Верх табло: три строки по 110 px стоят по центру кадра. */
const BOARD_TOP = 800;

const board = (() => {
  const {start, end} = scene("board");
  const root = sceneRoot("board", "var(--night)");
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: "Отголосок — это", style: {top: "690px", color: "var(--sage)"}});
  const width = Math.max(...BOARD.map((row) => row.length));
  const grid = el("div", {cls: "abs center-x", parent: root, style: {top: `${BOARD_TOP}px`, display: "grid", gap: "14px"}});
  const alphabet = "АБВГДЕЁЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789";
  const rows = BOARD.map((text, rowIndex) => {
    const padLeft = Math.floor((width - text.length) / 2);
    const cells = Array.from({length: width}, (_, index) => text[index - padLeft] ?? " ");
    const row = el("div", {cls: "board-row", parent: grid});
    const flaps = cells.map((char, index) => {
      const flap = el("div", {cls: "flap", parent: row});
      return {char, span: el("span", {parent: flap}), settle: 0.1 + rowIndex * BOARD_STEP + 0.18 + index * 0.022 + hash(rowIndex * 40 + index) * 0.12, seed: rowIndex * 40 + index};
    });
    const underline = el("div", {parent: root, style: {position: "absolute", left: "28px", height: "6px", borderRadius: "3px", background: "var(--coral)", top: `${BOARD_TOP + rowIndex * 110 + 100}px`, width: "1024px", transformOrigin: "0 50%"}});
    return {flaps, underline, at: 0.1 + rowIndex * BOARD_STEP};
  });
  const note = el("div", {cls: "abs center-x", parent: root, style: {top: `${BOARD_TOP + BOARD.length * 110 + 60}px`, font: "600 44px/1.3 var(--sans)", color: "var(--peach)"}});
  const noteLine = charLine(note, "Соберите свою прогулку на карте");

  return {root, start, end, tail: 0.6, update(time) {
    const local = time - start;
    css(kicker, {opacity: progress(local, 0, 0.4)});
    rows.forEach(({flaps, underline, at}) => {
      flaps.forEach(({char, span, settle, seed}) => {
        if (local < at) {
          span.textContent = " ";
          css(span, {transform: "none"});
          return;
        }
        if (local >= settle) {
          span.textContent = char;
          css(span, {transform: `scaleY(${Math.min(1, 0.4 + (local - settle) / 0.06).toFixed(3)})`});
          return;
        }
        const frame = Math.floor(local * FPS);
        span.textContent = char === " " ? " " : alphabet[Math.floor(hash(seed * 97 + frame) * alphabet.length)];
        css(span, {transform: `scaleY(${Math.abs(Math.cos(local * FPS * Math.PI * 0.5)).toFixed(3)})`});
      });
      const lastSettle = Math.max(...flaps.map(({settle}) => settle));
      css(underline, {transform: `scaleX(${progress(local, lastSettle, lastSettle + 0.35).toFixed(4)})`, opacity: 0.9});
    });
    revealChars(noteLine.chars, local, 2.2, {step: 0.012, length: 0.45});
  }};
})();

// ---------- Сцена 7: знак ----------

const brand = (() => {
  const {start, end} = scene("brand");
  const root = sceneRoot("brand", "var(--deep)");
  const ringList = rings(root, 7, {color: "var(--peach)", width: 3});
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: "Аудиопрогулки по Москве", style: {top: "640px", color: "var(--sage)"}});
  const mark = el("div", {cls: "abs center-x", parent: root, style: {top: "760px"}});
  const word = echoLine(mark, "Отголосок", {cls: "serif", style: {fontSize: "212px", color: "var(--cream)", fontWeight: "500"}, ghostColor: "var(--peach)"});
  const dot = el("span", {cls: "dot", parent: word.chars.at(-1).parentElement, style: {position: "relative", display: "inline-block", width: "34px", height: "34px", marginLeft: "10px", background: "var(--coral)"}});
  for (const copy of word.copies) el("span", {parent: copy, style: {display: "inline-block", width: "44px"}});
  const slogan = el("div", {cls: "abs center-x serif italic", parent: root, style: {top: "1030px", fontSize: "76px", color: "var(--peach)"}});
  const sloganLine = charLine(slogan, "Город говорит рядом");
  const pillWrap = el("div", {cls: "abs center-x", parent: root, style: {top: "1250px"}});
  const pill = el("div", {cls: "pill", parent: pillWrap});
  el("span", {parent: pill, text: "otgolosok.online"});
  const arrow = el("svg:svg", {parent: pill, attrs: {viewBox: "0 0 24 24", width: 44, height: 44}});
  el("svg:path", {parent: arrow, attrs: {d: "M5 12h13M13 6l6 6-6 6", fill: "none", stroke: COLORS.rust, "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round"}});
  const credit = el("div", {cls: "abs center-x", parent: root, text: data.attribution, style: {top: "1830px", font: "600 20px/1 var(--sans)", color: "var(--sage)", opacity: "0.55"}});
  const fade = el("div", {parent: root, style: {position: "absolute", inset: "0", background: "#000", opacity: "0"}});

  return {root, start, end, tail: 0, update(time) {
    const local = time - start;
    const radius = progress(local, 0, 0.6, ease.swing) * 2300;
    css(root, {clipPath: local < 0.6 ? `circle(${radius.toFixed(1)}px at 540px 960px)` : "none"});
    revealChars(word.chars, local, 0.2, {step: 0.05, length: 0.7});
    const beat = Math.max(0, 1 - ((local - 1.2) % 0.5) / 0.5) ** 3 * progress(local, 1.2, 1.3);
    updateEcho(word, local, 0.2, {spread: 60, pulse: beat});
    css(dot, {transform: `scale(${(spring(local - 0.85, {frequency: 2.2, damping: 6}) * (1 + beat * 0.3)).toFixed(4)})`});
    updateRings(ringList, local, {...layoutCenter(dot), from: 0.9, every: 0.5, life: 2.2, size: 1600});
    css(kicker, {opacity: progress(local, 0.8, 1.4), letterSpacing: `${lerp(30, 8, progress(local, 0.8, 1.9)).toFixed(2)}px`});
    revealChars(sloganLine.chars, local, 1.1, {step: 0.02});
    const pop = spring(local - 1.5, {frequency: 2, damping: 6.5});
    css(pill, {transform: `scale(${pop.toFixed(4)})`});
    css(arrow, {transform: `translateX(${(Math.sin(Math.max(0, local - 2) * 6) * 6).toFixed(2)}px)`});
    css(credit, {opacity: (0.55 * progress(local, 1.8, 2.4)).toFixed(3)});
    css(fade, {opacity: progress(local, 3.55, 4, ease.linear).toFixed(3)});
  }};
})();

// ---------- Общие слои ----------

// Порядок слоёв — по времени сцен: следующая сцена ложится поверх хвоста предыдущей.
const timeline = [hook, ask, map, facts, player, board, brand].sort((a, b) => a.start - b.start);
const flash = el("div", {parent: stage, attrs: {id: "flash"}});
el("div", {parent: stage, attrs: {id: "vignette"}});
const drawGrain = grainLayer(stage, FPS);

const punches = [...SCENES.slice(1).map(({start}) => start), ...FACTS.slice(1).map((_, index) => scene("facts").start + (index + 1) * FACT_LENGTH)];
const flashes = BOARD.map((_, index) => scene("board").start + 0.1 + index * BOARD_STEP);

/** Показать кадр в момент `time` (секунды). */
function seek(time) {
  timeline.forEach((item, index) => {
    const visible = time >= item.start && time < item.end + item.tail;
    css(item.root, {visibility: visible ? "visible" : "hidden", zIndex: index});
    if (visible) item.update(time);
  });
  const since = Math.min(...punches.map((cut) => (time >= cut ? time - cut : Infinity)));
  const punch = since < 0.4 ? 1 - progress(since, 0, 0.4, ease.outCubic) : 0;
  const preview = document.body.classList.contains("preview") ? "scale(var(--fit)) " : "";
  css(stage, {transform: `${preview}scale(${(1 + punch * 0.035).toFixed(4)})`});
  const sinceFlash = Math.min(...flashes.map((at) => (time >= at ? time - at : Infinity)));
  css(flash, {opacity: sinceFlash < 0.12 ? (0.22 * (1 - sinceFlash / 0.12)).toFixed(3) : 0});
  drawGrain(time);
}

async function ready() {
  await requireFonts(["400 32px Manrope", "600 32px Manrope", "700 32px Manrope", "800 32px Manrope", "500 32px 'Cormorant Garamond'", "600 32px 'Cormorant Garamond'", "italic 600 32px 'Cormorant Garamond'"]);
  seek(0);
}

window.motionScene = {ready: ready(), seek, width: WIDTH, height: HEIGHT};

if (new URLSearchParams(location.search).has("preview")) {
  document.body.classList.add("preview");
  document.documentElement.style.setProperty("--fit", String(Math.min(innerWidth / WIDTH, innerHeight / HEIGHT) * 0.96));
  const from = Number(new URLSearchParams(location.search).get("t") ?? 0);
  await window.motionScene.ready;
  const began = performance.now();
  const loop = (now) => {
    seek((from + (now - began) / 1000) % SCENES.at(-1).end);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
