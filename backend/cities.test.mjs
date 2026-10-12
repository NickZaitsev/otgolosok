import test from "node:test";
import assert from "node:assert/strict";
import { cityAt, cityByName, cityInAddress, regionCityAt, withoutCity } from "./cities.mjs";

test("a point belongs to the city whose walk area holds it, edges included", () => {
  /** @type {Array<[string, unknown, unknown, string | null]>} */
  const cases = [
    ["Кремль в Москве", 55.752, 37.6175, "Москва"],
    ["юго-западный угол Москвы", 55.48, 37.30, "Москва"],
    ["северо-восточный угол Москвы", 55.98, 37.95, "Москва"],
    ["за северной границей Москвы", 55.9801, 37.6, null],
    ["Казанский кремль", 55.7987, 49.1053, "Казань"],
    ["юго-западный угол Казани", 55.60, 48.82, "Казань"],
    ["северо-восточный угол Казани", 55.94, 49.39, "Казань"],
    ["за восточной границей Казани", 55.79, 49.3901, null],
    ["между городами", 55.8, 43.0, null],
    ["нулевая точка", 0, 0, null],
    ["NaN", Number.NaN, 37.6, null],
    ["строка вместо числа", "55.75", 37.6, null],
  ];
  for (const [name, lat, lon, expected] of cases) assert.equal(cityAt(lat, lon)?.name ?? null, expected, name);
});

test("the catalog region adds the outskirts but keeps the cities apart", () => {
  assert.equal(cityAt(55.3, 37.6), null);
  assert.equal(regionCityAt(55.3, 37.6)?.name, "Москва");
  assert.equal(regionCityAt(55.57, 49.1)?.name, "Казань");
  assert.equal(regionCityAt(55.8, 43.0), null);
});

test("a city is named in an address only as a whole word", () => {
  /** @type {Array<[string, string | null]>} */
  const cases = [
    ["Москва, Арбат, 1", "Москва"],
    ["Москва, Казанский переулок, 5", "Москва"],
    ["Казань, Московская улица, 3", "Казань"],
    ["г. Казань, улица Баумана, 19", "Казань"],
    ["улица Баумана, 19", null],
    ["Казанская улица, 7", null],
    ["Москворецкая набережная, 2", null],
  ];
  for (const [address, expected] of cases) assert.equal(cityInAddress(address)?.name ?? null, expected, address);
});

test("withoutCity drops only the leading city", () => {
  assert.equal(withoutCity("Москва, Садовническая улица, 5"), "Садовническая улица, 5");
  assert.equal(withoutCity("Казань, улица Баумана, 5"), "улица Баумана, 5");
  assert.equal(withoutCity("улица Баумана, 5"), "улица Баумана, 5");
});

test("cityByName knows only the covered cities", () => {
  assert.equal(cityByName("Казань")?.id, "kazan");
  assert.equal(cityByName("Москва")?.id, "moscow");
  assert.equal(cityByName("Санкт-Петербург"), null);
  assert.equal(cityByName(undefined), null);
});
