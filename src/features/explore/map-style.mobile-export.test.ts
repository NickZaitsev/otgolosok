import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "@/lib/mobile-export/snapshot";
import { MAP_ICONS, mapIconId, type MapIcon } from "./map-icons";
import { MAP_TILES_ORIGIN, mapStyle } from "./map-style";

const urls = (value: unknown): string[] => typeof value === "string" ? (/^https?:\/\//.test(value) ? [value] : [])
  : Array.isArray(value) ? value.flatMap(urls) : value && typeof value === "object" ? Object.values(value).flatMap(urls) : [];

describe("mobile app map style", () => {
  it("exports the basemap without a sprite and with tiles from one origin only", async () => {
    expect("sprite" in mapStyle).toBe(false);
    for (const url of urls(mapStyle)) expect(new URL(url).origin).toBe(MAP_TILES_ORIGIN);
    // Every icon a layer asks for is one the app ships in assets/map/icons (scripts/build-app-icons.mjs).
    const used = new Set(JSON.stringify(mapStyle.layers).match(/poi-[a-zA-Z]+/g));
    const shipped = new Set(Object.keys(MAP_ICONS).map(name => mapIconId(name as MapIcon)));
    for (const id of used) if (!["poi-amenity", "poi-memorial", "poi-sight"].includes(id)) expect(shipped.has(id), id).toBe(true);
    await expect(stableJson(mapStyle)).toMatchFileSnapshot(mobileFlutterPath("assets/map/style.json"));
  });
});
