import test from "node:test";
import assert from "node:assert/strict";
import metroData from "./metro-stations.json" with { type: "json" };
import { insideCircleStations, nearestMetro, routeMapPreview, routePreview } from "./walk-top-preview.mjs";

test("маршрут целиком помещается в превью, сохраняя поворот и концы", () => {
  const points = routePreview([
    { lat: 55.75, lon: 37.60 }, { lat: 55.75, lon: 37.61 }, { lat: 55.76, lon: 37.61 },
  ]);
  assert.equal(points.length, 3);
  assert.ok(points.every(([x, y]) => x >= 8 && x <= 92 && y >= 8 && y <= 92));
  assert.notDeepEqual(points[0], points.at(-1));
  assert.equal(routePreview([{ lat: 55.75, lon: 37.6 }]), null);
  assert.equal(routePreview([{ lat: 55.75, lon: 37.6 }, { lat: 55.75, lon: 37.6 }]), null);
});

test("длинный маршрут не раздувает ответ API и сохраняет конец", () => {
  const geometry = Array.from({ length: 1200 }, (_, index) => ({ lat: 55.75 + index * 0.00001, lon: 37.6 + Math.sin(index / 30) * 0.001 }));
  const preview = routePreview(geometry);
  assert.ok(preview.length <= 80);
  assert.ok(preview.length > 2);
  assert.ok(preview[0][1] > preview.at(-1)[1]);
});

test("карта в превью охватывает весь маршрут и только видимые тайлы", () => {
  const short = routeMapPreview([{ lat: 55.75, lon: 37.60 }, { lat: 55.751, lon: 37.601 }]);
  const long = routeMapPreview([{ lat: 55.75, lon: 37.60 }, { lat: 55.79, lon: 37.64 }]);
  assert.ok(short.zoom > long.zoom);
  for (const preview of [short, long]) {
    assert.ok(preview.tiles.length >= 1 && preview.tiles.length <= 4);
    assert.ok(preview.points.every(([x, y]) => x >= 38 && x <= 218 && y >= 38 && y <= 218));
    assert.ok(preview.tiles.every(tile => tile.x >= 0 && tile.y >= 0 && tile.x < 2 ** preview.zoom && tile.y < 2 ** preview.zoom));
  }
  assert.equal(routeMapPreview([{ lat: 55.75, lon: 37.6 }]), null);
  assert.equal(routeMapPreview([{ lat: NaN, lon: 37.6 }, { lat: 55.75, lon: 37.7 }]), null);
});

test("явное название метро у старта важнее соседней станции пересадки", () => {
  const point = { lat: 55.75, lon: 37.6 };
  const stations = [{ name: "Менделеевская", lat: 55.7505, lon: 37.6 }, { name: "Новослободская", lat: 55.75, lon: 37.6 }];
  assert.equal(nearestMetro(point, stations, "метро «Менделеевская»")?.name, "Менделеевская");
  assert.equal(nearestMetro(point, stations, "обычный адрес")?.name, "Новослободская");
  assert.equal(nearestMetro({ lat: 56, lon: 38 }, stations), null);
  assert.equal(nearestMetro(null, stations), null);
});

test("пересадка сохраняет цвета всех линий одной станции", () => {
  const point = { lat: 55.75, lon: 37.6 };
  const stations = [
    { name: "Арбатская", lat: 55.75, lon: 37.6, line: { id: "3", name: "Синяя", color: "#0072ba" } },
    { name: "Арбатская", lat: 55.7501, lon: 37.6, line: { id: "4", name: "Голубая", color: "#1ebcef" } },
    { name: "Арбатская", lat: 55.76, lon: 37.6, line: { id: "8", name: "Далёкая", color: "#ffcd1c" } },
  ];
  assert.deepEqual(nearestMetro(point, stations)?.lines.map(line => line.id), ["3", "4"]);
});

test("внутри Кольцевой: станции кольца, центра и короткие пересадки на кольцо", async t => {
  const inside = insideCircleStations(metroData.stations);
  /** @type {Array<[string, boolean]>} */
  const cases = [
    ["Павелецкая", true], ["Киевская", true], ["Комсомольская", true], ["Охотный ряд", true], ["Китай-город", true],
    ["Чкаловская", true], ["Марксистская", true], ["Менделеевская", true], ["Серпуховская", true],
    ["Улица 1905 года", false], ["Динамо", false], ["Спартак", false], ["Савёловская", false], ["Шаболовская", false], ["Бауманская", false],
  ];
  for (const [name, expected] of cases) await t.test(name, () => assert.equal(inside.has(name), expected));
  // A name counts when any of its platforms qualifies, so no qualifying name may also mark a distant station.
  const ring = metroData.stations.filter(station => station.line.id === "5");
  const farthest = Math.max(...metroData.stations.filter(station => inside.has(station.name))
    .map(station => Math.min(...ring.map(platform => Math.hypot((platform.lat - station.lat) * 111, (platform.lon - station.lon) * 63)))));
  assert.ok(farthest < 3, `${farthest} km`);
  assert.equal(insideCircleStations(metroData.stations.filter(station => station.line.id !== "5")).size, 0, "без кольца зоны нет");
});
