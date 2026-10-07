import { expect, it } from "vitest";
import { isPlaceId, placeMapUrl, placeSharePath, placeShareUrl, readPlaceParam } from "./place-link";

it.each([
  ["osm:node:1", true],
  ["osm:way:123456789", true],
  ["osm:relation:9999999999999999999", true],
  ["osm:node:0", false],
  ["osm:node:012", false],
  ["osm:node:12345678901234567890", false],
  ["osm:area:1", false],
  ["osm:node:1/../../admin", false],
  ["osm%3Anode%3A1", false],
  ["node:1", false],
  ["", false],
  [undefined, false],
  [7, false],
])("isPlaceId(%j) → %s", (value, expected) => {
  expect(isPlaceId(value)).toBe(expected);
});

it.each([
  ["", null],
  ["?place=osm:node:5", { id: "osm:node:5" }],
  ["?place=osm%3Away%3A7", { id: "osm:way:7" }],
  ["?place=garbage", { invalid: true }],
  ["?place=", { invalid: true }],
  ["?walk=create", null],
])("readPlaceParam(%j)", (search, expected) => {
  expect(readPlaceParam(new URLSearchParams(search))).toEqual(expected);
});

it("keeps the id readable in the map URL and maps it to the shared path", () => {
  expect(placeMapUrl("osm:node:123")).toBe("/?place=osm:node:123");
  expect(readPlaceParam(new URL(placeMapUrl("osm:relation:4"), "https://example.test").searchParams)).toEqual({ id: "osm:relation:4" });
  expect(placeSharePath("osm:node:123")).toBe("/place/node/123");
  expect(placeSharePath("osm:way:5")).toBe("/place/way/5");
  expect(placeShareUrl("osm:relation:6", "https://otgolosok.online")).toBe("https://otgolosok.online/place/relation/6");
  expect(() => placeSharePath("long-story")).toThrow();
});

it.each([
  ["ru" as const, "/place/node/123", "https://otgolosok.online/place/node/123"],
  ["en" as const, "/place/node/123?lang=en", "https://otgolosok.online/place/node/123?lang=en"],
  ["zh" as const, "/place/node/123?lang=zh", "https://otgolosok.online/place/node/123?lang=zh"],
])("keeps the %s UI language in shared links", (locale, path, url) => {
  expect(placeSharePath("osm:node:123", locale)).toBe(path);
  expect(placeShareUrl("osm:node:123", "https://otgolosok.online", locale)).toBe(url);
});
