import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "@/lib/mobile-export/snapshot";
import { nearbyRadiusForAccuracy, recommendNearbyStories, type NearbyStory } from "./nearby-stories";

const center = { lat: 55.75, lon: 37.62 };
const at = (meters: number) => ({ lat: center.lat + meters / 111_111, lon: center.lon });
const story = (id: string, meters: number, factCount: number, sourceCount: number, title = id): NearbyStory =>
  ({ id, title, address: `Адрес ${id}`, location: at(meters), durationSec: 60, sourceCount, factCount });
const catalog = [story("a", 50, 2, 3), story("b", 90, 5, 1), story("c", 150, 5, 1), story("d", 250, 1, 1),
  story("e", 80, 2, 3), story("f", 80, 2, 3, "Ёлка"), story("g", 80, 2, 3, "Арбат")];

describe("nearby story fixtures for the mobile app", () => {
  it("exports radius selection and ranking", async () => {
    const radii = [0, 50, 100, 100.5, 200, 300, 300.1, 1000].map(accuracyM => ({ accuracyM, radius: nearbyRadiusForAccuracy(accuracyM) }));
    const recommendations = (["ru", "en", "zh"] as const).flatMap(locale => ([100, 200, 300] as const).map(radius =>
      ({ locale, radius, result: recommendNearbyStories(center, radius, catalog, locale) })));
    expect(recommendations[0].result.length).toBeGreaterThan(0);
    await expect(stableJson({ center, catalog, radii, recommendations })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/engine/nearby_stories.json"));
  });
});
