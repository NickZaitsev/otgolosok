import test from "node:test";
import assert from "node:assert/strict";
import { nearestMetro, routePreview } from "./walk-top-preview.mjs";

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

test("явное название метро у старта важнее соседней станции пересадки", () => {
  const point = { lat: 55.75, lon: 37.6 };
  const stations = [{ name: "Менделеевская", lat: 55.7505, lon: 37.6 }, { name: "Новослободская", lat: 55.75, lon: 37.6 }];
  assert.equal(nearestMetro(point, stations, "метро «Менделеевская»")?.name, "Менделеевская");
  assert.equal(nearestMetro(point, stations, "обычный адрес")?.name, "Новослободская");
  assert.equal(nearestMetro({ lat: 56, lon: 38 }, stations), null);
  assert.equal(nearestMetro(null, stations), null);
});
