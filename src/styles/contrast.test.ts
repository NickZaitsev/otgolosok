import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Text and background pairs the design system allows, read from tokens.css: each must hold WCAG AA,
// 4.5:1 for text and 3:1 for marks and field borders. A palette change that breaks a pair fails here.
const css = readFileSync(join(__dirname, "tokens.css"), "utf8");
const token = (name: string) => {
  const value = new RegExp(`--${name}:\\s*#([0-9a-f]{6}|[0-9a-f]{3})\\b`, "i").exec(css)?.[1];
  if (!value) throw new Error(`--${name} is not a #rgb or #rrggbb token`);
  return "#" + (value.length === 3 ? [...value].map(c => c + c).join("") : value);
};

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT: [string, string][] = [
  ["ink", "paper"], ["ink", "raised"], ["ink", "surface-island"],
  ["muted", "paper"], ["muted", "raised"], ["muted", "notice-surface"],
  ["map-green", "surface-island"], ["map-green", "notice-surface"], ["map-green", "raised"],
  ["map-muted", "surface-island"], ["map-muted", "raised"],
  ["on-dark", "map-green"], ["on-dark", "map-orange"], ["on-dark", "accent"],
  ["alert-ink", "alert-surface"], ["danger-ink", "alert-surface"], ["danger-ink", "raised"],
  ["warning-ink", "warning-surface"], ["warning-ink", "raised"],
];
const MARKS: [string, string][] = [
  ["warning-mark", "warning-surface"], ["warning-ink", "surface-island"], ["danger-ink", "surface-island"], ["focus", "surface-island"], ["focus", "paper"],
  ["field-border", "field-surface"], ["field-border", "raised"], ["field-border", "surface-island"],
];

describe("контраст пар дизайн-системы", () => {
  it.each(TEXT)("текст %s на %s не меньше 4.5:1", (text, ground) => {
    expect(contrast(text, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)("отметка %s на %s не меньше 3:1", (mark, ground) => {
    expect(contrast(mark, ground)).toBeGreaterThanOrEqual(3);
  });

  it("map-muted на notice-surface не проходит — на страницах для такого текста есть muted", () => {
    expect(contrast("map-muted", "notice-surface")).toBeLessThan(4.5);
  });
});
