import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every colour of the interface comes from the palette in tokens.css. A literal hex elsewhere is allowed only
// when it is a palette colour (with or without alpha), so a near-duplicate shade cannot creep back in.
const root = join(__dirname, "..");
const tokens = readFileSync(join(__dirname, "tokens.css"), "utf8");

// legacy.css keeps its own colours only for the dark walk mode of the old built-in home tour
// (.shell[data-mode="walk"], .dek), which goes away with that tour (docs/agents/plans); its shared
// story and source styles already use the palette.
const SKIPPED = new Set(["styles/tokens.css", "styles/legacy.css"]);

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") && !SKIPPED.has(relative(root, path)) ? [path] : [];
  });
}

const expand = (hex: string) => (hex.length <= 5 ? [...hex.slice(1, 4)].map(c => c + c).join("") : hex.slice(1, 7)).toLowerCase();
const literals = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b/gi) ?? [];
const palette = new Set(literals(tokens).map(expand));

describe("палитра", () => {
  it("в tokens.css есть цвета, иначе проверка ничего не значит", () => {
    expect(palette.size).toBeGreaterThan(15);
  });

  it.each(cssFiles(root).map(path => [relative(root, path), path]))("%s берёт цвета только из палитры", (_, path) => {
    const foreign = [...new Set(literals(readFileSync(path, "utf8")).filter(hex => !palette.has(expand(hex))))];
    expect(foreign).toEqual([]);
  });
});
