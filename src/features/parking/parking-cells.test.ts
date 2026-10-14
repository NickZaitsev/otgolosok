import { expect, it } from "vitest";
import { createParkingCellStore, parseParkingCell, parseParkingManifest } from "./parking-cells";

const location = { lat: 55.751, lon: 37.601 };
const place = { id: "osm:node:1", name: "Парковка", location, entrance: location, exit: location, pedestrianAccess: location, access: "public" as const, fee: null, openingHours: null };
const manifest = { version: 1, cellSize: 0.05, sourceEditedAt: "2026-10-14T00:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: 1115, lon: 752, count: 1, etag: "a".repeat(32) }] };
const area = { south: 55.75, north: 55.79, west: 37.60, east: 37.64 };

it("загружает парковки области и повторяет неудавшуюся загрузку ячейки", async () => {
  let offline = true;
  const store = createParkingCellStore({ storage: { read: async () => null, write: async () => {} }, fetch: async path => {
    if (path.endsWith("/cells")) return new Response(JSON.stringify(manifest));
    if (offline) throw new TypeError("offline");
    return new Response(JSON.stringify({ lat: 1115, lon: 752, places: [place] }));
  } });
  expect(await store.loadArea(area)).toEqual([]);
  expect(store.snapshot().cellStatus.get("1115:752")).toBe("error");
  offline = false;
  await store.retry(area);
  expect(store.snapshot().places).toEqual([place]);
  expect(store.snapshot().manifest?.attribution).toBe(manifest.attribution);
});

it("отклоняет неверную ячейку, повторные записи и парковку вне ячейки", () => {
  const cell = { lat: 1115, lon: 752, places: [place] };
  expect(() => parseParkingCell(cell, "1115:753", 0.05)).toThrow();
  expect(() => parseParkingCell({ ...cell, places: [place, place] }, "1115:752", 0.05)).toThrow();
  expect(() => parseParkingCell({ ...cell, places: [{ ...place, location: { lat: 55.9, lon: 37.6 } }] }, "1115:752", 0.05)).toThrow();
  expect(() => parseParkingManifest({ ...manifest, cells: [manifest.cells[0], manifest.cells[0]] })).toThrow();
});
