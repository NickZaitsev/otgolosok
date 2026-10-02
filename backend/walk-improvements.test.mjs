import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { guestKeyHash } from "./walk-reviews.mjs";
import { normalizeIssues } from "./walk-improvements.mjs";

const guest = { guestKeyHash: guestKeyHash("A".repeat(43)) };
const otherGuest = { guestKeyHash: guestKeyHash("B".repeat(43)) };
const arbat = { kind: "catalog", id: "arbat", title: "Арбат", revision: 0 };
const kitay = { kind: "catalog", id: "kitay-gorod", title: "Китай-город", revision: 0 };

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO user VALUES ('anna','Анна','anna@example.test')`);
  let clock = Date.parse("2026-10-01T10:00:00Z");
  const store = createAccountStore(db, () => clock);
  return { db, store, tick: (ms = 1000) => { clock += ms; } };
}

test("normalizeIssues accepts known codes in canonical order and rejects the rest", () => {
  assert.deepEqual(normalizeIssues(["voiceover", "short_text"]), ["short_text", "voiceover"]);
  assert.deepEqual(normalizeIssues([]), []);
  assert.deepEqual(normalizeIssues(["short_text", "no_images", "voiceover"]), ["short_text", "no_images", "voiceover"]);
  for (const bad of [undefined, null, "voiceover", {}, ["other"], ["voiceover", "voiceover"], [1], ["short_text", "no_images", "voiceover", "x"]]) {
    assert.throws(() => normalizeIssues(bad), { code: "BAD_REQUEST" }, JSON.stringify(bad));
  }
});

test("a viewer keeps one request per walk: resend replaces it, an empty list withdraws it", () => {
  const { store, tick } = setup();
  assert.deepEqual(store.getWalkImprovement(arbat, guest), { mine: null });
  assert.deepEqual(store.getWalkImprovement(arbat, null), { mine: null });
  const first = store.saveWalkImprovement(arbat, guest, ["voiceover"]);
  assert.deepEqual(first.mine, { issues: ["voiceover"], status: "open", updatedAt: "2026-10-01T10:00:00.000Z" });
  tick();
  const second = store.saveWalkImprovement(arbat, guest, ["no_images", "short_text"]);
  assert.deepEqual(second.mine?.issues, ["short_text", "no_images"]);
  assert.equal(store.listWalkImprovementsAdmin().open, 1, "the resend replaced the request");
  assert.deepEqual(store.saveWalkImprovement(arbat, guest, []), { mine: null });
  assert.equal(store.listWalkImprovementsAdmin().open, 0);
  assert.deepEqual(store.saveWalkImprovement(arbat, otherGuest, []), { mine: null }, "withdrawing nothing is not an error");
  assert.throws(() => store.saveWalkImprovement(arbat, null, ["voiceover"]), { code: "BAD_REQUEST" });
});

test("the editor overview groups requests by walk, counts every issue and ranks by demand", () => {
  const { store, tick } = setup();
  store.saveWalkImprovement(arbat, guest, ["short_text", "voiceover"]); tick();
  store.saveWalkImprovement(arbat, { userId: "anna" }, ["voiceover"]); tick();
  store.saveWalkImprovement(kitay, guest, ["no_images"]);
  const page = store.listWalkImprovementsAdmin();
  assert.equal(page.open, 3);
  assert.equal(page.total, 2);
  assert.deepEqual(page.walks.map(item => [item.walk.id, item.total, item.issues]), [
    ["arbat", 2, { short_text: 1, no_images: 0, voiceover: 2 }],
    ["kitay-gorod", 1, { short_text: 0, no_images: 1, voiceover: 0 }],
  ]);
  assert.deepEqual(store.listWalkImprovementsAdmin({ issue: "no_images" }).walks.map(item => item.walk.id), ["kitay-gorod"]);
  assert.deepEqual(store.listWalkImprovementsAdmin({ q: "китай" }).walks.map(item => item.walk.id), ["kitay-gorod"]);
  const second = store.listWalkImprovementsAdmin({ limit: 1, offset: 1 });
  assert.deepEqual([second.walks[0].walk.id, second.hasMore], ["kitay-gorod", false]);
  assert.equal(store.listWalkImprovementsAdmin({ limit: 1, offset: 40 }).offset, 1, "an offset past the end clamps to the last page");
  for (const filters of [{ status: "bad" }, { issue: "sound" }, { limit: 0 }, { limit: 51 }, { offset: -1 }, { q: "x".repeat(121) }]) {
    assert.throws(() => store.listWalkImprovementsAdmin(/** @type {any} */ (filters)), { code: "BAD_REQUEST" }, JSON.stringify(filters));
  }
});

test("resolving closes the open requests of one walk; a later send reopens the viewer's request", () => {
  const { store, tick } = setup();
  store.saveWalkImprovement(arbat, guest, ["voiceover"]);
  store.saveWalkImprovement(kitay, guest, ["voiceover"]);
  tick();
  assert.equal(store.resolveWalkImprovements("catalog", "arbat", "editor"), 1);
  assert.equal(store.resolveWalkImprovements("catalog", "arbat", "editor"), 0, "nothing left to resolve");
  assert.equal(store.getWalkImprovement(arbat, guest).mine?.status, "resolved");
  assert.deepEqual(store.listWalkImprovementsAdmin().walks.map(item => item.walk.id), ["kitay-gorod"]);
  assert.deepEqual(store.listWalkImprovementsAdmin({ status: "resolved" }).walks.map(item => [item.walk.id, item.open]), [["arbat", 0]]);
  assert.equal(store.listWalkImprovementsAdmin({ status: "all" }).total, 2);
  tick();
  assert.equal(store.saveWalkImprovement(arbat, guest, ["voiceover"]).mine?.status, "open");
  assert.equal(store.listWalkImprovementsAdmin().open, 2);
  for (const [kind, id] of [["route", "arbat"], ["catalog", ""], ["catalog", 5]]) {
    assert.throws(() => store.resolveWalkImprovements(kind, /** @type {any} */ (id)), { code: "BAD_REQUEST" });
  }
});

test("requests of a deleted account go with it; guest requests stay", () => {
  const { store } = setup();
  store.saveWalkImprovement(arbat, { userId: "anna" }, ["voiceover"]);
  store.saveWalkImprovement(arbat, guest, ["short_text"]);
  store.deleteAccountData("anna");
  assert.deepEqual(store.listWalkImprovementsAdmin().walks[0].issues, { short_text: 1, no_images: 0, voiceover: 0 });
});
