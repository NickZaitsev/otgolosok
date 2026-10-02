import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { normalizePlaceFeedback } from "./place-feedback.mjs";

const place = { id: "osm:node:7", name: "Парк" }, guest = { guestKeyHash: "guest-one" }, other = { guestKeyHash: "guest-two" };
const dislike = { rating: -1, issues: ["voiceover"], text: "  Голос слишком тихий  " };
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('anna')");
  const store = createAccountStore(db);
  t.after(() => db.close());
  return { store, db };
}

test("feedback validation: canonical issues, optional text, limits and contradictory votes", () => {
  assert.deepEqual(normalizePlaceFeedback(dislike), { rating: -1, issues: ["voiceover"], text: "Голос слишком тихий" });
  assert.equal(normalizePlaceFeedback({ rating: -1, issues: [], text: "я".repeat(1000) }).text.length, 1000);
  for (const input of [null, {}, { rating: 0, issues: [], text: "" }, { ...dislike, extra: true },
    { ...dislike, issues: ["other"] }, { ...dislike, issues: ["voiceover", "voiceover"] },
    { ...dislike, text: "я".repeat(1001) }, { ...dislike, text: "x\u0000" },
    { ...dislike, rating: 1 }, { ...dislike, rating: null }, { rating: -1, issues: [] }]) {
    assert.throws(() => normalizePlaceFeedback(input), { code: "BAD_REQUEST" });
  }
});

test("votes persist, replace, remove and stay isolated by place and viewer", t => {
  const { store } = fixture(t);
  assert.deepEqual(store.getPlaceFeedback(place.id, guest), { mine: null });
  assert.equal(store.savePlaceFeedback(place, guest, { rating: 1, issues: [], text: "" }).mine.rating, 1);
  assert.equal(store.savePlaceFeedback(place, guest, dislike).mine.text, "Голос слишком тихий");
  assert.deepEqual(store.getPlaceFeedback(place.id, other), { mine: null });
  assert.deepEqual(store.getPlaceFeedback("osm:way:8", guest), { mine: null });
  assert.equal(store.listPlaceFeedbackAdmin().total, 1);
  store.savePlaceFeedback(place, other, { rating: -1, issues: [], text: "Побольше истории" });
  assert.equal(store.listPlaceFeedbackAdmin().total, 2);
  const like = store.savePlaceFeedback(place, guest, { rating: 1, issues: [], text: "" }).mine;
  assert.deepEqual([like.rating, like.issues, like.text], [1, [], ""]);
  assert.equal(store.listPlaceFeedbackAdmin().total, 1);
  assert.deepEqual(store.savePlaceFeedback(place, guest, { rating: null, issues: [], text: "" }), { mine: null });
  assert.throws(() => store.savePlaceFeedback(place, null, dislike), { code: "BAD_REQUEST" });
});

test("editor queue has private reasons without identity, pagination and idempotent resolution", t => {
  const { store } = fixture(t);
  store.savePlaceFeedback(place, guest, dislike);
  store.savePlaceFeedback(place, { userId: "anna" }, { rating: -1, issues: [], text: "Только комментарий" });
  const page = store.listPlaceFeedbackAdmin({ limit: 1 });
  assert.equal(page.total, 2); assert.equal(page.items.length, 1); assert.equal(page.hasMore, true);
  assert.equal(JSON.stringify(page).includes("guest-one"), false);
  assert.equal(JSON.stringify(page).includes("anna"), false);
  assert.equal(store.resolvePlaceFeedback(page.items[0].id).resolved, 1);
  assert.equal(store.resolvePlaceFeedback(page.items[0].id).resolved, 0);
  assert.equal(store.listPlaceFeedbackAdmin().total, 1);
  for (const options of [{ limit: 0 }, { limit: 51 }, { offset: -1 }]) assert.throws(() => store.listPlaceFeedbackAdmin(options), { code: "BAD_REQUEST" });
});

test("lost-response retry does not reopen resolved feedback; changed text does", t => {
  const { store, db } = fixture(t);
  store.savePlaceFeedback(place, guest, dislike);
  const id = store.listPlaceFeedbackAdmin().items[0].id;
  store.resolvePlaceFeedback(id);
  assert.equal(store.savePlaceFeedback(place, guest, dislike).mine.status, "resolved");
  assert.equal(store.savePlaceFeedback(place, guest, { ...dislike, text: "Другая проблема" }).mine.status, "open");
  store.savePlaceFeedback(place, { userId: "anna" }, dislike);
  db.prepare("DELETE FROM user WHERE id='anna'").run();
  assert.equal(store.listPlaceFeedbackAdmin().total, 1, "account deletion cascades");
});
