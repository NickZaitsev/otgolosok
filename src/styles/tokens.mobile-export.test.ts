import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mobileFlutterPath } from "@/lib/mobile-export/snapshot";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const tokens = new Map([...root.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map(match => [match[1], match[2].replace(/\s+/g, " ").trim()]));

const resolve = (value: string, seen = new Set<string>()): string => value.replace(/var\(--([a-z0-9-]+)\)/g, (_, name: string) => {
  if (seen.has(name)) throw new Error(`Cyclic token ${name}`);
  const next = tokens.get(name);
  if (next === undefined) throw new Error(`Unknown token ${name}`);
  return resolve(next, new Set([...seen, name]));
});

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** #rgb, #rrggbb and rgb(r g b / a%) → 0xAARRGGBB; anything else is not a colour. */
function argb(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join("") : hex[1];
    return `0xFF${digits.toUpperCase()}`;
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+(?:\.\d+)?)%)?\)$/.exec(value);
  if (!rgb) return null;
  const alpha = Math.round((rgb[4] === undefined ? 100 : Number(rgb[4])) * 2.55);
  return `0x${[alpha, Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map(part => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** rem → logical pixels at the 16 px root; 999px pills stay pixels. */
function pixels(value: string): number | null {
  const rem = /^(-?\d*\.?\d+)rem$/.exec(value);
  if (rem) return Number(rem[1]) * 16;
  const px = /^(-?\d*\.?\d+)px$/.exec(value);
  return px ? Number(px[1]) : null;
}

const dartNumber = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);

function dartTokens(): string {
  const colors: string[] = [], sizes: string[] = [], numbers: string[] = [];
  for (const [name, raw] of tokens) {
    const value = resolve(raw);
    const color = argb(value);
    if (color) { colors.push(`  static const ${camel(name)} = Color(${color});`); continue; }
    const size = pixels(value);
    if (size !== null) { sizes.push(`  static const double ${camel(name)} = ${dartNumber(size)};`); continue; }
    if (/^(leading|weight|z)-/.test(name) && /^-?\d*\.?\d+$/.test(value)) numbers.push(`  static const double ${camel(name)} = ${dartNumber(Number(value))};`);
  }
  return [
    "// GENERATED from src/styles/tokens.css by src/styles/tokens.mobile-export.test.ts — do not edit.",
    "// Regenerate: pnpm vitest run -u src/styles/tokens.mobile-export.test.ts",
    "// Sizes are logical pixels (1rem = 16). Fonts, shadows and env() insets are not tokens here.",
    "import 'dart:ui' show Color;",
    "",
    "abstract final class TokenColors {",
    ...colors,
    "}",
    "",
    "abstract final class TokenSizes {",
    ...sizes,
    "}",
    "",
    "abstract final class TokenNumbers {",
    ...numbers,
    "}",
    "",
  ].join("\n");
}

describe("mobile app design tokens", () => {
  it("resolves every colour and size the app needs", () => {
    expect(argb(resolve(tokens.get("paper")!))).toBe("0xFFF5F1E8");
    expect(argb(resolve(tokens.get("line")!))).toBe("0x2E1A1714");
    expect(pixels(resolve(tokens.get("control-primary-min")!))).toBe(48);
  });

  it("exports Dart constants", async () => {
    await expect(dartTokens()).toMatchFileSnapshot(mobileFlutterPath("lib/app/theme/tokens.g.dart"));
  });
});
