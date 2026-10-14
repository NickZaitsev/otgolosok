import { expect, it } from "vitest";
import { isParkingPlace, parseNearbyParking } from "./parking-client";

const location = { lat: 55.751, lon: 37.601 };
const place = { id: "osm:node:1", name: "Парковка", location, entrance: location, exit: location, pedestrianAccess: location, access: "public", fee: null, openingHours: null };
const source = { sourceEditedAt: "2026-10-14T00:00:00Z", attribution: "© участники OpenStreetMap" };

it("принимает общественную парковку и неизвестный доступ для ручного выбора", () => {
  expect(parseNearbyParking({ ...source, places: [place] }).places[0].access).toBe("public");
  expect(isParkingPlace({ ...place, access: "unknown" })).toBe(true);
  expect(parseNearbyParking({ ...source, places: [] }).places).toEqual([]);
});

it.each([
  { access: "private" }, { id: "javascript:alert(1)" }, { entrance: { lat: 100, lon: 37 } },
  { pedestrianAccess: null }, { location: { lat: Number.NaN, lon: 37 } }, { fee: "yes" },
])("отклоняет некорректную парковку %j", patch => {
  expect(() => parseNearbyParking({ ...source, places: [{ ...place, ...patch }] })).toThrow("Некорректные данные парковок.");
});

it("отклоняет повторяющиеся парковки и повреждённую дату источника", () => {
  expect(() => parseNearbyParking({ ...source, places: [place, place] })).toThrow();
  expect(() => parseNearbyParking({ ...source, sourceEditedAt: "unknown", places: [place] })).toThrow();
});
