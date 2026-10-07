import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every colour of the interface comes from the palette in tokens.css. A literal colour elsewhere is allowed
// only when it is a palette colour (with or without alpha), so a near-duplicate shade cannot creep back in.
const root = join(__dirname, "..");
const tokens = readFileSync(join(__dirname, "tokens.css"), "utf8");

// The old built-in home tour (its dark walk mode, classic-walk-view, the old walk map) and the field-test
// diagnostics panel keep their own colours until that tour is removed (docs/agents/plans). Everything
// else in legacy.css is shared by live screens and is checked.
const EXEMPT_SELECTOR = /\[data-mode="walk"\]|\.(signal-status|debug-panel|walk-map-canvas|walk-transcript|chapter-list|walk-next-hint|privacy-note)\b/;

const COLOR_PROPERTY = /^(--.*|color|background(-color)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|(box|text)-shadow|fill|stroke|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|scrollbar-color|stop-color|flood-color|lighting-color)$/;
const KEYWORDS = new Set(["transparent", "currentcolor", "inherit", "initial", "unset", "revert", "none"]);
const NAMED = new Set(("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "));

const hexBase = (hex: string) => (hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c).join("") : hex.slice(0, 6)).toLowerCase();

/** Declarations as [selector chain, property, value], comments removed. */
function declarations(css: string): [string, string, string][] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: [string, string, string][] = [];
  const stack: string[] = [];
  let text = "";
  const flush = () => {
    const match = /^\s*([-a-zA-Z]+)\s*:\s*([\s\S]+?)\s*$/.exec(text);
    if (match && stack.length) out.push([stack.join(" "), match[1].toLowerCase(), match[2]]);
    text = "";
  };
  for (const char of clean) {
    if (char === "{") { stack.push(text.trim()); text = ""; }
    else if (char === "}") { flush(); stack.pop(); }
    else if (char === ";") flush();
    else text += char;
  }
  return out;
}

/** Colours in a value that are not in the palette, or that cannot be checked against it. */
function foreignInValue(value: string, palette: Set<string>): string[] {
  const foreign: string[] = [];
  // Strings and url() hold text and fragment ids, not colours.
  const rest = value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ").replace(/url\([^)]*\)/gi, " ").replace(/#([0-9a-z]+)/gi, (whole, digits: string) => {
    if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits) || !palette.has(hexBase(digits))) foreign.push(whole);
    return " ";
  }).replace(/rgba?\(([^)]*)\)/gi, (whole, args: string) => {
    const parts = args.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    const channels = parts.map(Number);
    const ok = parts.length === 3 && channels.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
      && palette.has(channels.map(n => n.toString(16).padStart(2, "0")).join(""));
    if (!ok) foreign.push(whole);
    return " ";
  }).replace(/\b(hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi, whole => { foreign.push(whole); return " "; });
  // Custom property names such as var(--map-green) are not colour words.
  for (const word of rest.replace(/--[\w-]+/g, " ").toLowerCase().match(/[a-z]+/g) ?? []) if (NAMED.has(word) && !KEYWORDS.has(word)) foreign.push(word);
  return foreign;
}

function foreignColors(css: string, palette: Set<string>, exempt?: RegExp) {
  return [...new Set(declarations(css)
    .filter(([selector, property]) => COLOR_PROPERTY.test(property) && !exempt?.test(selector))
    .flatMap(([, , value]) => foreignInValue(value, palette)))];
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") && relative(root, path) !== "styles/tokens.css" ? [path] : [];
  });
}

const palette = new Set(declarations(tokens).flatMap(([, , value]) => (value.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map(hex => hexBase(hex.slice(1)))));

describe("распознавание цветов", () => {
  const sample = new Set(["203e38", "ffffff"]);
  it.each([
    ["цвет из палитры", "a { color: #203e38 }", []],
    ["короткий и с альфой", "a { color: #fff; border-color: #203e3818 }", []],
    ["чужой hex", "a { color: #123456 }", ["#123456"]],
    ["hex неверной длины", "a { color: #203e380 }", ["#203e380"]],
    ["rgb из палитры с альфой", "a { background: rgb(32 62 56 / 12%) }", []],
    ["чужой rgb", "a { color: rgb(255 0 255) }", ["rgb(255 0 255)"]],
    ["hsl не сверить с палитрой", "a { color: hsl(300 100% 50%) }", ["hsl(300 100% 50%)"]],
    ["именованный цвет", "a { color: rebeccapurple; background: white }", ["rebeccapurple", "white"]],
    ["ключевые слова", "a { color: currentColor; background: transparent }", []],
    ["hex в селекторе", "#abc { display: block }", []],
    ["hex в url и строке", "a { background: url(#abc); content: \"#abc\" }", []],
    ["не цветовое свойство", "a { grid-area: tan; font-family: Georgia }", []],
    ["переменная с цветом", "a { --x: #123456 }", ["#123456"]],
    ["имя переменной не цвет", "a { color: var(--map-green); --admin-green: var(--map-green) }", []],
  ])("%s", (_, css, expected) => {
    expect(foreignColors(css, sample)).toEqual(expected);
  });

  it("исключение касается только своего селектора", () => {
    const css = '.shell[data-mode="walk"] a { color: #123456 } .dek { color: #654321 }';
    expect(foreignColors(css, sample, EXEMPT_SELECTOR)).toEqual(["#654321"]);
  });
});

describe("палитра", () => {
  it("в tokens.css есть цвета, иначе проверка ничего не значит", () => {
    expect(palette.size).toBeGreaterThan(15);
  });

  it.each(cssFiles(root).map(path => [relative(root, path), path]))("%s берёт цвета только из палитры", (name, path) => {
    const exempt = name === "styles/legacy.css" ? EXEMPT_SELECTOR : undefined;
    expect(foreignColors(readFileSync(path, "utf8"), palette, exempt)).toEqual([]);
  });
});
