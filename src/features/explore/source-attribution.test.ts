import { describe, expect, it } from "vitest";
import { openDataAttribution } from "./source-attribution";

describe("openDataAttribution", () => {
  it.each([
    ["no sources", undefined, undefined],
    ["only web pages", [{ url: "https://example.org/a", publisher: "example.org" }], undefined],
    ["a data.mos.ru record", [{ url: "https://example.org/a", publisher: "example.org" }, { url: "https://data.mos.ru/opendata/2801", publisher: "data.mos.ru" }],
      { url: "https://data.mos.ru/opendata/2801", label: "Портал открытых данных Правительства Москвы" }],
    ["a forged publisher with a foreign link", [{ url: "https://evil.example/", publisher: "data.mos.ru" }], undefined],
  ])("%s", (_name, sources, expected) => {
    expect(openDataAttribution(sources)).toEqual(expected);
  });
});
