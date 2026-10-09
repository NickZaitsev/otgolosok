import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlacePhoto } from "./place-story";
import photos from "../../../backend/place-images-editorial.json";

const catalog: Record<string, PlacePhoto & { gallery?: PlacePhoto[] }> = photos;
const images = Object.entries(catalog).flatMap(([id, photo]) => [[id, photo] as const, ...(photo.gallery ?? []).map(image => [id, image] as const)]);

describe("редакционный каталог фотографий", () => {
  it.each(images)("%s: изображение и указание авторства готовы к публикации", (id, photo) => {
    expect(id).toMatch(/^osm:(node|way|relation):\d+$/);
    expect(photo.alt.trim().length).toBeGreaterThan(5);
    expect(photo.author?.trim().length).toBeGreaterThan(0);
    expect(photo.license.trim().length).toBeGreaterThan(0);
    const source = new URL(photo.sourceUrl);
    const flickr = source.hostname === "www.flickr.com";
    expect(source.hostname === "commons.wikimedia.org" || flickr ||
      (source.origin === "https://otgolosok.online" && source.pathname === photo.src)).toBe(true);
    expect(["https:", "http:"]).toContain(new URL(photo.licenseUrl).protocol);
    expect(photo.width).toBeGreaterThan(0);
    expect(photo.height).toBeGreaterThan(0);
    expect(photo.src).not.toBe(photo.thumbnail);
    if (flickr) {
      const photoId = /^\/photos\/[^/]+\/(\d+)\/$/.exec(source.pathname)?.[1];
      expect(photoId).toBeTruthy();
      for (const [url, size] of [[photo.thumbnail, "q"], [photo.src, "b"]]) {
        expect(url).toMatch(new RegExp(`^https://live\\.staticflickr\\.com/\\d+/${photoId}_[a-f0-9]+_${size}\\.jpg$`));
      }
      expect(photo.license).toContain("встраивание Flickr");
      return;
    }
    for (const path of [photo.thumbnail, photo.src]) {
      expect(path).toMatch(/^\/images\/places\/[a-z0-9-]+\.jpg$/);
      const bytes = readFileSync(fileURLToPath(new URL(`../../../public${path}`, import.meta.url)));
      expect(path).toContain(createHash("sha256").update(bytes).digest("hex").slice(0, 12));
      expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
      expect(bytes.length).toBeLessThan(path === photo.thumbnail ? 60_000 : 1_000_000);
    }
  });
});
