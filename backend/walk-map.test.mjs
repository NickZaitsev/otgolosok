import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createWalkMap, simplifyLine, WALK_MAP_TOLERANCE_M } from "./walk-map.mjs";

const M_PER_LAT = 6371000 * Math.PI / 180;
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const CITY = { west: 37.3, south: 55.5, east: 37.9, north: 55.95 };
/** @param {Array<{lat: number, lon: number}>} geometry */
const document = geometry => {
  const start = { address: "Москва, Тестовая, 1", location: geometry[0] }, stop = { address: "Москва, Тестовая, 2", location: geometry.at(-1) };
  return { version: 2, id: uuid(), title: "Прогулка", description: "", city: "Москва", mode: "open", minutes: 30, start,
    stops: [{ id: uuid(), place: stop, storyRef: null, transition: "", nextHint: "" }],
    route: { geometry, distanceM: 3200, walkingMinutes: 45, attribution: "OSM" }, fieldChecked: false };
};
const segment = (/** @type {number} */ lat, /** @type {number} */ lon) => [{ lat, lon }, { lat: lat + 0.005, lon }];

/** @param {any} t */
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO user VALUES ('anna','Анна','anna@example.test')`);
  const accountStore = createAccountStore(db), store = createStore(":memory:");
  t.after(() => { store.close(); db.close(); });
  let key = 0;
  /**
   * @param {string} title @param {Array<{lat: number, lon: number}>} geometry
   * @param {{visibility?: "private" | "shared" | "public", decision?: "approve" | "hide" | null}} [options]
   */
  const walk = (title, geometry, { visibility = "public", decision = "approve" } = {}) => {
    const created = accountStore.createWalk("anna", { title, snapshot: document(geometry), idempotencyKey: `map-walk-${key++}` });
    if (visibility === "private") return created;
    const result = accountStore.setWalkVisibility("anna", created.id, created.revision, visibility);
    if (visibility === "public" && decision) accountStore.moderateWalkListing(result.id, { action: decision, revision: result.revision });
    return result;
  };
  const launched = (/** @type {string} */ id, /** @type {number} */ launches) => db.prepare("INSERT INTO walk_launch_days VALUES(?,?,?,?)").run("account", id, "2026-10-01", launches);
  /** @type {string[][]} */
  const decoded = [];
  const counting = Object.create(accountStore, { getTopDocuments: { value: (/** @type {string[]} */ ids) => { decoded.push([...ids]); return accountStore.getTopDocuments(ids); } } });
  const map = createWalkMap({ accountStore: counting, store, builtinRoutes: [], limit: 3 });
  const damage = (/** @type {string} */ id) => db.prepare("UPDATE user_walks SET snapshot_json='{' WHERE id=?").run(id);
  /** @param {string} id @param {Array<{lat: number, lon: number}>} geometry */
  const reroute = (id, geometry) => {
    const current = accountStore.getWalk("anna", id);
    accountStore.updateWalk("anna", id, { title: current.title, snapshot: { ...document(geometry), id: current.snapshot.id }, revision: current.revision });
  };
  return { walk, launched, damage, reroute, decoded, map, list: (area = CITY) => map.list(area).walks };
}

test("only approved public walks with a route are drawn", async t => {
  /** @type {Array<[string, Parameters<ReturnType<typeof fixture>["walk"]>[2], boolean]>} */
  const cases = [
    ["approved public", {}, true],
    ["private", { visibility: "private" }, false],
    ["link only", { visibility: "shared" }, false],
    ["pending moderation", { decision: null }, false],
    ["hidden by the editor", { decision: "hide" }, false],
  ];
  for (const [name, options, shown] of cases) await t.test(name, t => {
    const f = fixture(t);
    f.walk("Прогулка", segment(55.75, 37.6), options);
    assert.equal(f.list().length, shown ? 1 : 0);
  });
});

test("an item carries the share token, card details and the line, never the owner or the account id", t => {
  const f = fixture(t);
  const created = f.walk("Арбат", segment(55.75, 37.6));
  const [item] = f.list();
  assert.deepEqual(item, { kind: "shared", id: created.shareToken, title: "Арбат", walkingMinutes: 45, distanceM: 3200, stopCount: 1,
    rating: { average: null, count: 0 }, line: [[55.75, 37.6], [55.755, 37.6]] });
  assert.doesNotMatch(JSON.stringify(item), new RegExp(`${created.id}|anna`));
});

test("the area selects walks whose line enters it, touching the edge included", async t => {
  const f = fixture(t);
  f.walk("Внутри", segment(55.75, 37.6));
  f.walk("Севернее", segment(55.8, 37.6));
  /** @type {Array<[string, {west: number, south: number, east: number, north: number}, string[]]>} */
  const cases = [
    ["around the first", { west: 37.59, south: 55.74, east: 37.61, north: 55.76 }, ["Внутри"]],
    ["edge on the line's last vertex", { west: 37.59, south: 55.755, east: 37.61, north: 55.79 }, ["Внутри"]],
    ["between the walks", { west: 37.59, south: 55.76, east: 37.61, north: 55.79 }, []],
    ["east of both", { west: 37.61, south: 55.7, east: 37.7, north: 55.9 }, []],
    ["the whole city", CITY, ["Внутри", "Севернее"]],
  ];
  for (const [name, area, expected] of cases) await t.test(name, () => assert.deepEqual(f.list(area).map(walk => walk.title).sort(), [...expected].sort()));
});

test("walks follow the top order and a damaged walk is skipped", t => {
  const f = fixture(t);
  f.walk("Без запусков", segment(55.75, 37.6));
  const popular = f.walk("Популярная", segment(55.76, 37.6));
  f.launched(popular.id, 10);
  f.damage(f.walk("Повреждённая", segment(55.77, 37.6)).id);
  assert.deepEqual(f.list().map(walk => walk.title), ["Популярная", "Без запусков"]);
});

test("simplifyLine keeps the shape within the tolerance and drops straight-line vertices", async t => {
  const north = (/** @type {number} */ meters, east = 0) => ({ lat: 55.75 + meters / M_PER_LAT, lon: 37.6 + east / (M_PER_LAT * Math.cos(55.75 * Math.PI / 180)) });
  /** @type {Array<[string, Array<{lat: number, lon: number}>, number]>} */
  const cases = [
    ["a straight street keeps only its ends", [north(0), north(100), north(200), north(300)], 2],
    ["a bend wider than the tolerance stays", [north(0), north(100, WALK_MAP_TOLERANCE_M * 3), north(200)], 3],
    ["a wobble under the tolerance goes", [north(0), north(100, WALK_MAP_TOLERANCE_M / 2), north(200)], 2],
    ["a single point is no line", [north(0)], 0],
    ["invalid vertices are ignored", [north(0), { lat: Number.NaN, lon: 37.6 }, north(100)], 2],
  ];
  for (const [name, geometry, length] of cases) await t.test(name, () => assert.equal(simplifyLine(geometry).length, length));
});

test("a cut list is marked incomplete; a full one is complete", t => {
  const f = fixture(t);
  for (let index = 0; index < 3; index += 1) f.walk(`Прогулка ${index}`, segment(55.75 + index * 0.01, 37.6));
  assert.equal(f.map.list(CITY).complete, true);
  f.walk("Четвёртая", segment(55.79, 37.6));
  const cut = f.map.list(CITY);
  assert.deepEqual([cut.walks.length, cut.complete], [3, false]);
  // An area that the limit does not reach stays complete.
  assert.equal(f.map.list({ west: 37.59, south: 55.745, east: 37.61, north: 55.756 }).complete, true);
});

test("lines are decoded once per revision: an edit redraws the walk, an unchanged walk is not decoded again", t => {
  const f = fixture(t);
  const created = f.walk("Арбат", segment(55.75, 37.6));
  f.list();
  f.list();
  assert.deepEqual(f.decoded, [[created.id]]);
  f.reroute(created.id, segment(55.8, 37.7));
  assert.deepEqual(f.list().map(walk => walk.line[0]), [[55.8, 37.7]]);
  assert.deepEqual(f.decoded, [[created.id], [created.id]]);
});
