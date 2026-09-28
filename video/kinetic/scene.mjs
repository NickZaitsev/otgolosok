// Кинетический рекламный ролик Отголоска: вся анимация — чистая функция времени
// `seek(t)`, без CSS-переходов и таймеров, поэтому любой кадр воспроизводим.
// Скрипт scripts/render-kinetic-video.mjs (через scripts/lib/frame-render.mjs) листает кадры и снимает их Playwright.
import {
  FPS, HEIGHT, SCENES, VOICE, WIDTH,
  clamp, ease, hash, lerp, parsePolyline, polyline, progress, scene, spring, stripesPolygon,
} from "/timeline.mjs";

const stage = document.getElementById("stage");

// ---------- DOM и типографика ----------

function el(tag, {cls, parent = stage, text, style, attrs} = {}) {
  const node = tag.startsWith("svg:")
    ? document.createElementNS("http://www.w3.org/2000/svg", tag.slice(4))
    : document.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  if (text !== undefined) node.textContent = text;
  if (style) Object.assign(node.style, style);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
  parent.appendChild(node);
  return node;
}

function css(node, style) {
  for (const [name, value] of Object.entries(style)) {
    const text = String(value);
    if (node.style[name] !== text) node.style[name] = text;
  }
}

/** Строка из букв под маской; буквы выезжают по одной. */
function charLine(parent, text, {cls = "", style} = {}) {
  const line = el("div", {cls: `line ${cls}`, parent, style});
  const mask = el("span", {cls: "mask", parent: line});
  const chars = Array.from(text, (char) => el("span", {cls: "char", parent: mask, text: char}));
  return {line, chars};
}

function revealChars(chars, time, at, {step = 0.035, length = 0.6, lift = 112, tilt = 12} = {}) {
  chars.forEach((char, index) => {
    const shown = progress(time, at + index * step, at + index * step + length);
    css(char, {transform: `translateY(${(1 - shown) * lift}%) rotate(${(1 - shown) * tilt}deg)`});
  });
}

/** Строка с «отголосками»: копии позади сходятся к тексту, как затухающее эхо. */
function echoLine(parent, text, {cls = "", style, ghosts = 4, ghostColor}) {
  const wrap = el("div", {cls: "line", parent, style: {position: "relative", ...style}});
  const copies = Array.from({length: ghosts}, () =>
    el("div", {cls: `ghost ${cls}`, parent: wrap, text, style: {color: "transparent", webkitTextStroke: `2px ${ghostColor}`}}));
  const {chars} = charLine(wrap, text, {cls});
  return {wrap, copies, chars};
}

function updateEcho({copies}, time, at, {spread = 44, pulse = 0} = {}) {
  const settle = progress(time, at + 0.1, at + 1.1, ease.outCubic);
  copies.forEach((copy, index) => {
    const order = index + 1;
    const offset = order * spread * (1 - settle) + order * 9 * pulse;
    const visible = progress(time, at + 0.05 * order, at + 0.25 + 0.05 * order, ease.linear);
    css(copy, {transform: `translateY(${offset}px)`, opacity: (visible * (0.55 - index * 0.11) * (0.35 + 0.65 * (1 - settle) + pulse * 0.6)).toFixed(3)});
  });
}

/** Круги, расходящиеся от точки. */
function rings(parent, count, {color, width = 3}) {
  return Array.from({length: count}, () => el("div", {cls: "ring", parent, style: {borderColor: color, borderWidth: `${width}px`}}));
}

function updateRings(list, time, {x, y, from, every, life = 1.6, size = 1400}) {
  list.forEach((ring, index) => {
    const born = from + index * every;
    const age = (time - born) / life;
    if (age <= 0 || age >= 1) {
      css(ring, {opacity: 0});
      return;
    }
    const diameter = 30 + (size - 30) * ease.outCubic(age);
    css(ring, {
      left: `${x - diameter / 2}px`, top: `${y - diameter / 2}px`, width: `${diameter}px`, height: `${diameter}px`,
      opacity: ((1 - age) ** 1.4 * 0.85).toFixed(3),
    });
  });
}

function sceneRoot(id, background) {
  return el("section", {cls: "scene", attrs: {"data-scene": id}, style: {background}});
}

function relativeRect(node) {
  const box = stage.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const scale = WIDTH / box.width;
  return {
    x: (rect.left - box.left + rect.width / 2) * scale,
    y: (rect.top - box.top + rect.height / 2) * scale,
  };
}

/** Момент, когда монотонная функция времени впервые достигает значения. */
function timeWhen(fn, target, from, to) {
  let low = from;
  let high = to;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (fn(middle) >= target) high = middle;
    else low = middle;
  }
  return high;
}

// ---------- Данные ----------

const response = await fetch("/data.json");
if (!response.ok) throw new Error(`Нет данных ролика: ${response.status}`);
/** @type {{title: string, distanceM: number, durationMin: number, stops: {x: number, y: number, label: string}[], path: string, levels: number[]}} */
const data = await response.json();

const voiceLevel = (time) => {
  const index = Math.round((time - VOICE.at) * FPS);
  return data.levels[index] ?? 0;
};

// ---------- Сцена 1: «Прислушайтесь к городу» ----------

const hook = (() => {
  const {start, end} = scene("hook");
  const root = sceneRoot("hook", "var(--deep)");
  const dotAt = {x: 540, y: 1330};
  const ringList = rings(root, 8, {color: "var(--peach)"});
  const dot = el("div", {cls: "dot", parent: root, style: {width: "44px", height: "44px", left: `${dotAt.x - 22}px`, top: `${dotAt.y - 22}px`, background: "var(--coral)"}});
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: "Москва · аудиопрогулки", style: {top: "360px", color: "var(--sage)"}});
  const text = el("div", {cls: "abs center-x", parent: root, style: {top: "610px"}});
  const first = echoLine(text, "Прислушайтесь", {cls: "serif italic", style: {fontSize: "150px", color: "var(--cream)"}, ghostColor: "var(--peach)"});
  const second = echoLine(text, "к городу.", {cls: "serif", style: {fontSize: "150px", color: "var(--peach)", marginTop: "18px"}, ghostColor: "var(--coral)"});

  return {root, start, end, tail: 0.7, update(time) {
    const local = time - start;
    const beat = Math.max(0, 1 - ((local - 0.15) % 0.5) / 0.5) ** 3;
    css(dot, {transform: `scale(${(spring(local - 0.05, {frequency: 2, damping: 6}) * (1 + beat * 0.25)).toFixed(4)})`});
    updateRings(ringList, local, {...dotAt, from: 0.15, every: 0.36, life: 1.9, size: 1500});
    css(kicker, {letterSpacing: `${lerp(40, 8, progress(local, 0.1, 1.3))}px`, opacity: progress(local, 0.1, 0.8)});
    revealChars(first.chars, local, 0.3, {step: 0.04});
    revealChars(second.chars, local, 0.85, {step: 0.05});
    updateEcho(first, local, 0.3, {pulse: beat * progress(local, 1.4, 1.6)});
    updateEcho(second, local, 0.85, {pulse: beat * progress(local, 1.6, 1.8)});
    const exit = progress(local, 2.55, 3.1, ease.inQuart);
    css(text, {transform: `scale(${1 + exit * 0.12})`, filter: `blur(${exit * 14}px)`, opacity: 1 - exit});
    css(kicker, {transform: `translateY(${-exit * 80}px)`});
  }, dotAt};
})();

// ---------- Сцена 2: «У каждого дома — своя история» ----------

const facade = (() => {
  const {start, end} = scene("facade");
  const root = sceneRoot("facade", "var(--paper)");
  const head = el("div", {cls: "abs center-x serif", parent: root, style: {top: "170px", fontSize: "132px", color: "var(--ink)"}});
  const lead = charLine(head, "У каждого");
  const slotLine = el("div", {cls: "line", parent: head, style: {marginTop: "28px"}});
  const slot = el("span", {cls: "slot italic", parent: slotLine, style: {width: "900px", color: "var(--rust)"}});
  const words = ["переулка", "двора", "фасада", "дома"].map((word) => el("span", {cls: "slot-word", parent: slot, text: word}));

  const arch = el("div", {cls: "arch", parent: root, style: {left: "170px", top: "560px", width: "740px", height: "1000px"}});
  const photo = el("img", {parent: arch, attrs: {src: "/assets/facade.webp", alt: ""}});
  const shade = el("div", {parent: arch, style: {position: "absolute", inset: "0", background: "linear-gradient(180deg, transparent 55%, rgba(26,23,20,0.55))"}});

  const badge = el("svg:svg", {parent: root, attrs: {viewBox: "0 0 300 300", width: 300, height: 300}, style: {position: "absolute", left: "730px", top: "470px"}});
  el("svg:circle", {parent: badge, attrs: {cx: 150, cy: 150, r: 146, fill: "#203e38"}});
  el("svg:path", {parent: badge, attrs: {id: "badge-path", d: "M150,150 m-108,0 a108,108 0 1,1 216,0 a108,108 0 1,1 -216,0", fill: "none"}});
  const badgeText = el("svg:text", {parent: badge, attrs: {fill: "#fffefa", "font-family": "Manrope", "font-weight": 700, "font-size": 27, "letter-spacing": 5}});
  el("svg:textPath", {parent: badgeText, text: "ИСТОРИИ РЯДОМ • ИСТОРИИ РЯДОМ • ", attrs: {href: "#badge-path"}});
  el("svg:circle", {parent: badge, attrs: {cx: 150, cy: 150, r: 20, fill: "#ff7a5c"}});

  const tail = el("div", {cls: "abs center-x serif", parent: root, style: {top: "1600px", fontSize: "124px", color: "var(--ink)"}});
  const tailLine = charLine(tail, "— своя история");

  return {root, start, end, tail: 0.8, update(time) {
    const local = time - start;
    const radius = progress(local, 0, 0.7, ease.swing) * 2300;
    css(root, {clipPath: local < 0.7 ? `circle(${radius}px at ${hook.dotAt.x}px ${hook.dotAt.y}px)` : "none"});

    revealChars(lead.chars, local, 0.2, {step: 0.03});
    // Слот-машина: слово уезжает вверх с размытием, следующее приходит снизу.
    const swap = 0.55;
    words.forEach((word, index) => {
      const enter = 0.35 + index * swap;
      const inAmount = progress(local, enter, enter + 0.32, ease.expo);
      const out = index === words.length - 1 ? 0 : progress(local, enter + swap, enter + swap + 0.32, ease.expo);
      const moving = Math.max(Math.min(inAmount, 1 - inAmount), Math.min(out, 1 - out));
      css(word, {
        transform: `translateY(${(1 - inAmount) * 110 - out * 110}%) scaleY(${1 + moving * 0.5})`,
        filter: `blur(${moving * 10}px)`,
      });
    });

    const open = progress(local, 0.25, 1.2, ease.expo);
    css(arch, {clipPath: `inset(${(1 - open) * 100}% 0 0 0)`, transform: `translateY(${(1 - open) * 120}px)`});
    css(photo, {transform: `scale(${lerp(1.4, 1.06, progress(local, 0.25, 4.6, ease.outCubic))}) translateY(${lerp(3, -2, local / 4)}%)`});
    css(shade, {opacity: 0.6 + 0.4 * open});

    const pop = spring(local - 0.9, {frequency: 1.6, damping: 6});
    css(badge, {transform: `scale(${pop.toFixed(4)}) rotate(${local * 36}deg)`});
    revealChars(tailLine.chars, local, 2.55, {step: 0.03});
  }};
})();

// ---------- Сцена 3: маршрут на карте ----------

const map = (() => {
  const {start, end} = scene("map");
  const root = sceneRoot("map", "var(--deep)");
  const points = parsePolyline(data.path);
  const route = polyline(points);
  const focus = {x: (130 / 400) * 100, y: (205 / 400) * 100};
  const size = 1320;

  const camera = el("div", {parent: root, style: {position: "absolute", inset: "0", perspective: "2200px", perspectiveOrigin: "50% 40%"}});
  const slab = el("div", {cls: "slab", parent: camera, style: {width: `${size}px`, height: `${size}px`, left: `${540 - (focus.x / 100) * size}px`, top: `${1130 - (focus.y / 100) * size}px`, transformOrigin: `${focus.x}% ${focus.y}%`}});
  el("img", {parent: slab, attrs: {src: "/assets/map.svg", alt: ""}});
  const tint = el("div", {parent: slab, style: {position: "absolute", inset: "0", background: "radial-gradient(circle at 32% 51%, transparent 20%, rgba(13,23,20,0.55) 70%)"}});
  const overlay = el("svg:svg", {parent: slab, attrs: {viewBox: "0 0 400 400"}});
  const halo = el("svg:path", {parent: overlay, attrs: {d: data.path, fill: "none", stroke: "#ff7a5c", "stroke-opacity": 0.35, "stroke-width": 11, "stroke-linecap": "round", "stroke-linejoin": "round"}});
  const line = el("svg:path", {parent: overlay, attrs: {d: data.path, fill: "none", stroke: "#b64b28", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round"}});
  for (const path of [halo, line]) path.setAttribute("stroke-dasharray", String(route.length));
  const stopRings = data.stops.map(() => Array.from({length: 2}, () => el("svg:circle", {parent: overlay, attrs: {fill: "none", stroke: "#ff7a5c", "stroke-width": 2}})));
  const markers = data.stops.map((stop, index) => {
    const group = el("svg:g", {parent: overlay});
    const circle = el("svg:circle", {parent: group, attrs: {r: 12, fill: "#b64b28", stroke: "#fffefa", "stroke-width": 3}});
    el("svg:text", {parent: group, text: String(index + 1), attrs: {y: 4, "text-anchor": "middle", fill: "#fffefa", "font-family": "Manrope", "font-weight": 700, "font-size": 12}});
    return {group, circle};
  });
  const head = el("svg:g", {parent: overlay});
  el("svg:circle", {parent: head, attrs: {r: 16, fill: "#ff7a5c", "fill-opacity": 0.3}});
  el("svg:circle", {parent: head, attrs: {r: 7, fill: "#fffefa", stroke: "#b64b28", "stroke-width": 3}});

  el("div", {parent: root, style: {position: "absolute", left: "0", right: "0", top: "0", height: "640px", background: "linear-gradient(180deg, #0d1714 45%, rgba(13,23,20,0))"}});
  el("div", {parent: root, style: {position: "absolute", left: "0", right: "0", bottom: "0", height: "520px", background: "linear-gradient(0deg, #0d1714 45%, rgba(13,23,20,0))"}});

  const title = el("div", {cls: "abs center-x", parent: root, style: {top: "150px"}});
  const kicker = el("div", {cls: "kicker", parent: title, text: `Маршрут · ${data.durationMin} минут`, style: {color: "var(--peach)", marginBottom: "34px"}});
  const titleA = charLine(title, "От истории —", {cls: "serif", style: {fontSize: "112px", color: "var(--cream)"}});
  const titleB = charLine(title, "к истории", {cls: "serif italic", style: {fontSize: "112px", color: "var(--peach)"}});

  const chips = data.stops.map((stop, index) => {
    const chip = el("div", {cls: "chip", parent: root});
    el("b", {parent: chip, text: String(index + 1)});
    el("span", {parent: chip, text: stop.label});
    return chip;
  });

  const counters = el("div", {parent: root, style: {position: "absolute", left: "60px", right: "60px", top: "1670px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)"}});
  const counterValues = [
    {value: data.distanceM, label: "метров пешком"},
    {value: data.stops.length, label: "истории"},
    {value: data.durationMin, label: "минут"},
  ].map(({value, label}) => {
    const box = el("div", {cls: "counter", parent: counters});
    const number = el("strong", {parent: box, text: "0"});
    el("span", {parent: box, text: label});
    return {box, number, value};
  });

  const draw = (local) => progress(local, 1.0, 3.9, ease.swing);
  const popAt = data.stops.map((stop) => timeWhen(draw, route.shareNear(stop), 1.0, 3.9));

  return {root, start, end, tail: 0.6, update(time) {
    const local = time - start;
    css(root, {clipPath: local < 0.8 ? stripesPolygon(Array.from({length: 8}, (_, index) => progress(local, index * 0.05, index * 0.05 + 0.45, ease.expo))) : "none"});

    const enter = progress(local, 0.1, 2.2, ease.expo);
    const exit = progress(local, 4.9, 5.6, ease.inQuart);
    css(slab, {transform: `rotateX(${lerp(58, 32, enter)}deg) rotateZ(${lerp(-24, -9, enter) + local * 0.6}deg) scale(${lerp(0.7, 1, enter) * (1 + exit * 1.3)})`});
    css(tint, {opacity: 1 - progress(local, 0.6, 1.6) * 0.55});

    const drawn = draw(local);
    for (const path of [halo, line]) path.setAttribute("stroke-dashoffset", String(route.length * (1 - drawn)));
    const tip = route.at(drawn);
    head.setAttribute("transform", `translate(${tip.x} ${tip.y}) scale(${drawn > 0 && drawn < 1 ? 1 : 0})`);

    markers.forEach(({group}, index) => {
      const stop = data.stops[index];
      const scale = spring(local - popAt[index], {frequency: 2.2, damping: 6});
      group.setAttribute("transform", `translate(${stop.x} ${stop.y}) scale(${scale.toFixed(4)})`);
      stopRings[index].forEach((ring, order) => {
        const age = (local - popAt[index] - order * 0.22) / 1.2;
        const alive = age > 0 && age < 1;
        ring.setAttribute("cx", String(stop.x));
        ring.setAttribute("cy", String(stop.y));
        ring.setAttribute("r", String(12 + ease.outCubic(clamp(age)) * 46));
        ring.setAttribute("stroke-opacity", alive ? String((1 - age) * 0.9) : "0");
      });
    });

    markers.forEach(({circle}, index) => {
      const shown = progress(local, popAt[index] + 0.08, popAt[index] + 0.6, ease.expo) * (1 - exit);
      const chip = chips[index];
      if (shown <= 0) {
        css(chip, {opacity: 0});
        return;
      }
      const point = relativeRect(circle);
      const width = chip.offsetWidth;
      // Подпись справа от метки, а если не помещается — слева.
      const right = point.x + 52 + width < WIDTH - 36;
      const left = right ? point.x + 52 : point.x - 52 - width;
      css(chip, {left: `${clamp(left, 36, WIDTH - 36 - width)}px`, top: `${point.y - chip.offsetHeight / 2}px`, opacity: shown, transform: `translateX(${(1 - shown) * (right ? -60 : 60)}px) scale(${0.85 + shown * 0.15})`});
    });

    css(kicker, {opacity: progress(local, 0.3, 0.9), letterSpacing: `${lerp(24, 8, progress(local, 0.3, 1.2))}px`});
    revealChars(titleA.chars, local, 0.35, {step: 0.03});
    revealChars(titleB.chars, local, 0.6, {step: 0.04});
    css(title, {opacity: 1 - exit, transform: `translateY(${-exit * 120}px)`});

    counterValues.forEach(({box, number, value}, index) => {
      const shown = progress(local, 1.3 + index * 0.15, 2.0 + index * 0.15);
      const count = progress(local, 1.3 + index * 0.15, 3.8, ease.outCubic);
      number.textContent = String(Math.round(value * count));
      css(box, {opacity: shown * (1 - exit), transform: `translateY(${(1 - shown) * 80 + exit * 120}px)`});
    });
  }};
})();

// ---------- Сцена 4: прослушивание ----------

const listen = (() => {
  const {start, end} = scene("listen");
  const root = sceneRoot("listen", "var(--night)");
  const barCount = 34;
  const wave = el("div", {parent: root, style: {position: "absolute", left: "0", right: "0", top: "560px", height: "940px"}});
  const bars = Array.from({length: barCount}, (_, index) => el("div", {cls: "bar", parent: wave, style: {left: `${index * (WIDTH / barCount) + 7}px`, width: `${WIDTH / barCount - 14}px`, background: index % 2 ? "var(--rust)" : "var(--coral)"}}));

  const camera = el("div", {parent: root, style: {position: "absolute", inset: "0", perspective: "2400px"}});
  const phoneWidth = 560;
  const phoneHeight = 1040;
  const phone = el("div", {cls: "phone", parent: camera, style: {left: `${540 - phoneWidth / 2}px`, top: "560px", width: `${phoneWidth}px`, height: `${phoneHeight}px`}});
  // Снимок экрана 2560×1600: в «телефон» попадает центральная полоса с панелью прослушивания.
  const screenHeight = phoneHeight - 32;
  const screenWidth = phoneWidth - 32;
  const shot = screenHeight / 1600;
  const screen = el("div", {cls: "screen", parent: phone, style: {
    backgroundImage: "url(/assets/listen.png)",
    backgroundSize: `${2560 * shot}px ${screenHeight}px`,
    backgroundPosition: `${-(1280 * shot - screenWidth / 2)}px 0`,
  }});
  el("div", {cls: "notch", parent: screen});
  const play = {x: 945 * shot - (1280 * shot - screenWidth / 2), y: 975 * shot};
  const playRings = rings(screen, 3, {color: "var(--coral)", width: 4});

  const title = el("div", {cls: "abs center-x", parent: root, style: {top: "150px"}});
  const kicker = el("div", {cls: "kicker", parent: title, style: {color: "var(--teal)", marginBottom: "34px", display: "inline-flex", alignItems: "center", gap: "18px"}});
  const gps = el("i", {parent: kicker, style: {display: "inline-block", width: "18px", height: "18px", borderRadius: "50%", background: "var(--teal)"}});
  el("span", {parent: kicker, text: "Вы на месте"});
  const titleA = charLine(title, "История", {cls: "serif", style: {fontSize: "118px", color: "#f2ede4"}});
  const titleB = charLine(title, "звучит сама", {cls: "serif italic", style: {fontSize: "118px", color: "var(--peach)"}});

  const pillWrap = el("div", {cls: "abs center-x", parent: root, style: {top: "1680px"}});
  const pill = el("div", {cls: "pill", parent: pillWrap});
  const eq = el("span", {cls: "eq", parent: pill});
  const eqBars = Array.from({length: 4}, () => el("i", {parent: eq}));
  el("span", {parent: pill, text: `1 из ${data.stops.length} · ${data.stops[0].label}`});

  return {root, start, end, tail: 0, update(time) {
    const local = time - start;
    const wipe = lerp(135, -35, progress(local, 0, 0.6, ease.swing));
    css(root, {clipPath: local < 0.6 ? `polygon(0% 100%, 0% ${wipe}%, 100% ${wipe - 35}%, 100% 100%)` : "none"});

    const level = voiceLevel(time);
    bars.forEach((bar, index) => {
      const shape = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.9 + hash(index) * 3));
      const idle = 0.06 + 0.04 * Math.sin(local * 5 + index * 0.6);
      const height = 40 + 820 * Math.max(idle, level * shape * (0.8 + 0.2 * Math.sin(local * 11 + index)));
      const shown = progress(local, 0.2 + Math.abs(index - barCount / 2) * 0.012, 0.9);
      css(bar, {height: `${height * shown}px`, bottom: `${470 - (height * shown) / 2}px`, opacity: 0.85});
    });

    const enter = progress(local, 0.15, 1.3, ease.expo);
    const float = Math.sin(local * 1.6) * 10;
    css(phone, {transform: `translateY(${(1 - enter) * 1300 + float}px) rotateX(${lerp(30, 8, enter)}deg) rotateY(${lerp(-28, -10, enter) + local * 1.2}deg) rotateZ(${lerp(10, -2, enter)}deg)`});
    updateRings(playRings, local, {...play, from: 1.0, every: 0.5, life: 1.3, size: 240});

    css(gps, {boxShadow: `0 0 0 ${(local * 2 % 1) * 16}px rgba(92,207,197,${(1 - (local * 2 % 1)) * 0.5})`});
    css(kicker, {opacity: progress(local, 0.35, 0.9)});
    revealChars(titleA.chars, local, 0.4, {step: 0.035});
    revealChars(titleB.chars, local, 0.65, {step: 0.035});

    const pillIn = progress(local, 1.1, 1.8);
    css(pill, {opacity: pillIn, transform: `translateY(${(1 - pillIn) * 60}px)`});
    eqBars.forEach((bar, index) => css(bar, {height: `${8 + 26 * clamp(level * (0.6 + 0.4 * Math.sin(local * 14 + index * 1.7)) + 0.1)}px`}));
  }};
})();

// ---------- Сцена 5: три обещания ----------

const trust = (() => {
  const {start, end} = scene("trust");
  const root = sceneRoot("trust", "var(--night)");
  const promises = [
    {top: "Рядом", bottom: "с местом", note: "История звучит там, где случилась", bg: "#b64b28", fg: "#fffefa", accent: "#f5b296"},
    {top: "Факты", bottom: "с источниками", note: "Каждую историю можно проверить", bg: "#f5f1e8", fg: "#1a1714", accent: "#b64b28"},
    {top: "Экран —", bottom: "в кармане", note: "Слушайте город, а не листайте", bg: "#203e38", fg: "#fffefa", accent: "#f5b296"},
  ];
  const cards = promises.map((promise, index) => {
    const card = el("div", {cls: "card", parent: root, style: {background: promise.bg, color: promise.fg}});
    const numeral = el("div", {cls: "abs numeral", parent: card, text: `0${index + 1}`, style: {left: "70px", top: "300px", color: promise.accent}});
    const text = el("div", {cls: "abs", parent: card, style: {left: "80px", top: "820px"}});
    const lines = [
      charLine(text, promise.top, {cls: "serif", style: {fontSize: "150px", whiteSpace: "nowrap"}}),
      charLine(text, promise.bottom, {cls: "serif italic", style: {fontSize: "150px", whiteSpace: "nowrap", color: promise.accent}}),
    ];
    const rule = el("div", {parent: card, style: {position: "absolute", left: "80px", top: "1290px", height: "6px", width: "920px", background: promise.accent, transformOrigin: "0 50%"}});
    const note = el("div", {parent: card, text: promise.note, style: {position: "absolute", left: "80px", top: "1340px", font: "600 40px/1.3 var(--sans)", maxWidth: "860px"}});
    const ticker = el("div", {cls: "ticker", parent: card, text: "ОТГОЛОСОК • ".repeat(12), style: {top: "1760px", color: promise.accent}});
    return {card, numeral, lines, rule, note, ticker};
  });

  return {root, start, end, tail: 0.6, update(time) {
    const local = time - start;
    const index = clamp(Math.floor(local), 0, cards.length - 1);
    cards.forEach(({card}, order) => css(card, {visibility: order === index ? "visible" : "hidden"}));
    const {card, numeral, lines, rule, note, ticker} = cards[index];
    const part = local - index;
    css(card, {transform: `scale(${1 + 0.06 * (1 - progress(part, 0, 0.5, ease.expo))})`});
    lines.forEach(({chars}, order) => revealChars(chars, part, 0.02 + order * 0.1, {step: 0.018, length: 0.45}));
    css(numeral, {transform: `translateX(${(1 - progress(part, 0, 0.6)) * -200}px)`, opacity: progress(part, 0, 0.3, ease.linear)});
    css(rule, {transform: `scaleX(${progress(part, 0.1, 0.6)})`});
    css(note, {opacity: progress(part, 0.25, 0.6), transform: `translateY(${(1 - progress(part, 0.25, 0.7)) * 30}px)`});
    css(ticker, {transform: `translateX(${-((time * 260) % 520)}px)`});
  }};
})();

// ---------- Сцена 6: знак ----------

const brand = (() => {
  const {start, end} = scene("brand");
  const root = sceneRoot("brand", "var(--deep)");
  const ringList = rings(root, 7, {color: "var(--peach)", width: 3});
  const mark = el("div", {cls: "abs center-x", parent: root, style: {top: "780px"}});
  const word = echoLine(mark, "Отголосок", {cls: "serif", style: {fontSize: "212px", color: "var(--cream)", fontWeight: "500"}, ghostColor: "var(--peach)"});
  const dot = el("span", {cls: "dot", parent: word.chars.at(-1).parentElement, style: {position: "relative", display: "inline-block", width: "34px", height: "34px", marginLeft: "10px", background: "var(--coral)"}});
  // Точка знака расширяет строку: те же отступы у отголосков, иначе они съедут вбок.
  for (const copy of word.copies) el("span", {parent: copy, style: {display: "inline-block", width: "44px"}});
  const kicker = el("div", {cls: "abs center-x kicker", parent: root, text: "Аудиопрогулки по Москве", style: {top: "650px", color: "var(--sage)"}});
  const slogan = el("div", {cls: "abs center-x serif italic", parent: root, style: {top: "1180px", fontSize: "70px", lineHeight: "1.1", color: "var(--peach)"}});
  const sloganA = charLine(slogan, "Город говорит там,");
  const sloganB = charLine(slogan, "где случилась история");
  const fade = el("div", {parent: root, style: {position: "absolute", inset: "0", background: "#000"}});

  return {root, start, end, tail: 0, update(time) {
    const local = time - start;
    const radius = progress(local, 0, 0.6, ease.swing) * 2300;
    css(root, {clipPath: local < 0.6 ? `circle(${radius}px at 540px 960px)` : "none"});
    revealChars(word.chars, local, 0.25, {step: 0.05, length: 0.7});
    const beat = Math.max(0, 1 - ((local - 1.2) % 0.5) / 0.5) ** 3 * progress(local, 1.2, 1.3);
    updateEcho(word, local, 0.25, {spread: 60, pulse: beat});
    const pop = spring(local - 0.9, {frequency: 2.2, damping: 6});
    css(dot, {transform: `scale(${(pop * (1 + beat * 0.3)).toFixed(4)})`});
    const center = relativeRect(dot);
    updateRings(ringList, local, {...center, from: 1.0, every: 0.5, life: 2.2, size: 1600});
    css(kicker, {opacity: progress(local, 0.9, 1.5), letterSpacing: `${lerp(30, 8, progress(local, 0.9, 2))}px`});
    revealChars(sloganA.chars, local, 1.4, {step: 0.02});
    revealChars(sloganB.chars, local, 1.6, {step: 0.02});
    css(fade, {opacity: progress(local, 3.5, 4, ease.linear)});
  }};
})();

// ---------- Общие слои ----------

const timeline = [hook, facade, map, listen, trust, brand];
const flash = el("div", {parent: stage, attrs: {id: "flash"}});
el("div", {parent: stage, attrs: {id: "vignette"}});
const grain = el("canvas", {parent: stage, attrs: {id: "grain", width: 360, height: 640}});
const grainContext = grain.getContext("2d");
const grainFrames = Array.from({length: 8}, (_, frame) => {
  const image = grainContext.createImageData(360, 640);
  let seed = 0x9e3779b9 ^ (frame * 7919);
  for (let index = 0; index < image.data.length; index += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const value = (seed >>> 0) % 256;
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  return image;
});

const cuts = SCENES.slice(1).map(({start}) => start);

/** Показать кадр в момент `time` (секунды). */
function seek(time) {
  for (const item of timeline) {
    const visible = time >= item.start && time < item.end + item.tail;
    css(item.root, {visibility: visible ? "visible" : "hidden", zIndex: SCENES.findIndex(({id}) => id === item.root.dataset.scene)});
    if (visible) item.update(time);
  }
  const sinceCut = Math.min(...cuts.map((cut) => (time >= cut ? time - cut : Infinity)));
  const punch = sinceCut < 0.4 ? 1 - progress(sinceCut, 0, 0.4, ease.outCubic) : 0;
  css(stage, {transform: `${document.body.classList.contains("preview") ? "scale(var(--fit)) " : ""}scale(${1 + punch * 0.03})`});
  const hardCut = [scene("trust").start, scene("trust").start + 1, scene("trust").start + 2].some((cut) => time >= cut && time - cut < 0.1);
  css(flash, {opacity: hardCut ? 0.35 * (1 - (time % 1) / 0.1) : 0});
  grainContext.putImageData(grainFrames[Math.round(time * FPS) % grainFrames.length], 0, 0);
}

async function ready() {
  const faces = ["400 32px Manrope", "600 32px Manrope", "700 32px Manrope", "500 32px 'Cormorant Garamond'", "600 32px 'Cormorant Garamond'", "italic 600 32px 'Cormorant Garamond'"];
  const loaded = await Promise.all(faces.map((face) => document.fonts.load(face, "Отголосок Aa")));
  const missing = faces.filter((_, index) => loaded[index].length === 0);
  if (missing.length) throw new Error(`Не загружены шрифты: ${missing.join(", ")}`);
  await Promise.all(Array.from(document.images, (image) => image.decode()));
  const shot = new Image();
  shot.src = "/assets/listen.png";
  await shot.decode();
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
