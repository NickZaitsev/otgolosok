// DOM-помощники покадровых сцен: всё состояние задаётся из seek(t) через css(),
// никаких CSS-переходов и таймеров — кадр зависит только от времени.
import {ease, progress} from "./motion.mjs";

/**
 * Создать узел; `svg:`-префикс создаёт элемент SVG.
 * @param {string} tag
 * @param {{cls?: string, parent: Element, text?: string, style?: Record<string, string>, attrs?: Record<string, unknown>}} options
 */
export function el(tag, {cls, parent, text, style, attrs}) {
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

/** Записать только изменившиеся свойства стиля. */
export function css(node, style) {
  for (const [name, value] of Object.entries(style)) {
    const text = String(value);
    if (node.style[name] !== text) node.style[name] = text;
  }
}

/** То же для атрибутов (SVG). */
export function attr(node, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }
}

/** Строка из букв под маской; буквы выезжают по одной. */
export function charLine(parent, text, {cls = "", style} = {}) {
  const line = el("div", {cls: `line ${cls}`, parent, style});
  const mask = el("span", {cls: "mask", parent: line});
  const chars = Array.from(text, (char) => el("span", {cls: "char", parent: mask, text: char}));
  return {line, chars};
}

export function revealChars(chars, time, at, {step = 0.035, length = 0.6, lift = 112, tilt = 12} = {}) {
  chars.forEach((char, index) => {
    const shown = progress(time, at + index * step, at + index * step + length);
    css(char, {transform: `translateY(${((1 - shown) * lift).toFixed(2)}%) rotate(${((1 - shown) * tilt).toFixed(2)}deg)`});
  });
}

/** Строка с «отголосками»: контурные копии позади сходятся к тексту, как затухающее эхо. */
export function echoLine(parent, text, {cls = "", style, ghosts = 4, ghostColor}) {
  const wrap = el("div", {cls: "line", parent, style: {position: "relative", ...style}});
  const copies = Array.from({length: ghosts}, () =>
    el("div", {cls: `ghost ${cls}`, parent: wrap, text, style: {color: "transparent", webkitTextStroke: `2px ${ghostColor}`}}));
  const {chars} = charLine(wrap, text, {cls});
  return {wrap, copies, chars};
}

export function updateEcho({copies}, time, at, {spread = 44, pulse = 0} = {}) {
  const settle = progress(time, at + 0.1, at + 1.1, ease.outCubic);
  copies.forEach((copy, index) => {
    const order = index + 1;
    const offset = order * spread * (1 - settle) + order * 9 * pulse;
    const visible = progress(time, at + 0.05 * order, at + 0.25 + 0.05 * order, ease.linear);
    css(copy, {transform: `translateY(${offset.toFixed(2)}px)`, opacity: (visible * (0.55 - index * 0.11) * (0.35 + 0.65 * (1 - settle) + pulse * 0.6)).toFixed(3)});
  });
}

/** Круги, расходящиеся от точки. */
export function rings(parent, count, {color, width = 3}) {
  return Array.from({length: count}, () => el("div", {cls: "ring", parent, style: {borderColor: color, borderWidth: `${width}px`, opacity: "0"}}));
}

export function updateRings(list, time, {x, y, from, every, life = 1.6, size = 1400}) {
  list.forEach((ring, index) => {
    const born = from + index * every;
    const age = (time - born) / life;
    if (age <= 0 || age >= 1) {
      css(ring, {opacity: 0});
      return;
    }
    const diameter = 30 + (size - 30) * ease.outCubic(age);
    css(ring, {
      left: `${(x - diameter / 2).toFixed(1)}px`, top: `${(y - diameter / 2).toFixed(1)}px`, width: `${diameter.toFixed(1)}px`, height: `${diameter.toFixed(1)}px`,
      opacity: ((1 - age) ** 1.4 * 0.85).toFixed(3),
    });
  });
}

/** Процедурное зерно плёнки: восемь заранее посчитанных кадров шума. */
export function grainLayer(parent, fps) {
  const canvas = el("canvas", {parent, attrs: {id: "grain", width: 360, height: 640}});
  const context = canvas.getContext("2d");
  const frames = Array.from({length: 8}, (_, frame) => {
    const image = context.createImageData(360, 640);
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
  return (time) => context.putImageData(frames[Math.round(time * fps) % frames.length], 0, 0);
}

/** Проверка шрифтов: рендер без нужного начертания хуже, чем остановка. */
export async function requireFonts(faces, sample = "Отголосок Aa 0123") {
  const loaded = await Promise.all(faces.map((face) => document.fonts.load(face, sample)));
  const missing = faces.filter((_, index) => loaded[index].length === 0);
  if (missing.length) throw new Error(`Не загружены шрифты: ${missing.join(", ")}`);
}
