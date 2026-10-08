import { describe, expect, it } from "vitest";
import { placePhotoGallery } from "./place-photo-gallery";
import type { PlacePhoto } from "./place-story";

const remote: PlacePhoto = {
  src: `/api/place-images/${"a".repeat(64)}.jpg`, thumbnail: `/api/place-images/${"b".repeat(64)}.jpg`,
  width: 960, height: 640, alt: "Снимок из опубликованной карточки", author: "Автор",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg", license: "CC0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
};

describe("фотографии места независимо от наличия отдельного рассказа", () => {
  it("не подставляет снимок другого объекта для неизвестного места", () => {
    expect(placePhotoGallery("osm:node:0")).toEqual([]);
    expect(placePhotoGallery(undefined)).toEqual([]);
  });
  it("сохраняет серверное фото у места без редакционной подборки", () => {
    expect(placePhotoGallery("osm:node:0", remote)).toEqual([remote]);
  });
  it.each(["osm:way:76633316", "osm:node:3423510101"])("%s: превью работает при 404 отдельной карточки", id => {
    const photos = placePhotoGallery(id);
    expect(photos).toHaveLength(1);
    expect(photos[0].src).toMatch(/^\/images\/places\//);
    expect(photos[0].sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
  });
  it("палаты показывают фасад 1927 года и панораму 1867 года без дубликатов", () => {
    const photos = placePhotoGallery("osm:way:48859891");
    expect(photos).toHaveLength(2);
    expect(photos[0].alt).toContain("1927");
    expect(photos[1].alt).toContain("1867");
    expect(placePhotoGallery("osm:way:48859891", photos[0])).toEqual(photos);
  });
  it("серверная фотография остаётся основной, авторство каждого архивного кадра отдельно", () => {
    const photos = placePhotoGallery("osm:way:48859891", remote);
    expect(photos[0]).toEqual(remote);
    expect(photos[1].author).toBe("Автор неизвестен");
    expect(photos[1].sourceUrl).not.toBe(remote.sourceUrl);
  });
});
