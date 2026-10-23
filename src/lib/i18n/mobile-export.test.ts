import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "../mobile-export/snapshot";
import { translations } from "./translate";

describe("mobile app translations", () => {
  it("exports every interface string with the site's placeholders", async () => {
    const entries = Object.entries(translations);
    // Placeholders are part of the contract: the app substitutes them with the same regex as translate().
    const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();
    for (const [source, [en, zh]] of entries) {
      expect(placeholders(en), source).toEqual(placeholders(source));
      expect(placeholders(zh), source).toEqual(placeholders(source));
    }
    await expect(stableJson(Object.fromEntries(entries))).toMatchFileSnapshot(mobileFlutterPath("assets/i18n/translations.json"));
  });
});
