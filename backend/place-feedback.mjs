import { randomUUID } from "node:crypto";
import { normalizeIssues } from "./walk-improvements.mjs";

export const PLACE_FEEDBACK_TEXT_MAX = 1000;
const badRequest = () => Object.assign(new Error("Invalid place feedback"), { code: "BAD_REQUEST" });

export function normalizePlaceFeedback(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["rating", "issues", "text"].includes(key))
    || ![null, 1, -1].includes(input.rating)) throw badRequest();
  const issues = normalizeIssues(input.issues);
  if (typeof input.text !== "string" || input.text.length > PLACE_FEEDBACK_TEXT_MAX
    || /[\p{Cc}\p{Cf}]/u.test(input.text.replace(/[\n\r\t]/g, ""))) throw badRequest();
  const text = input.text.trim();
  if (input.rating !== -1 && (issues.length || text)) throw badRequest();
  return { rating: input.rating, issues, text };
}

/** Private feedback, one replaceable vote per place and account/device. */
export function createPlaceFeedbackStore(db, { now = Date.now, transaction }) {
  db.exec(`CREATE TABLE IF NOT EXISTS place_feedback (
    id TEXT PRIMARY KEY, place_id TEXT NOT NULL, place_title TEXT NOT NULL,
    user_id TEXT REFERENCES user(id) ON DELETE CASCADE, guest_key_hash TEXT,
    rating INTEGER NOT NULL CHECK(rating IN (-1,1)), issues_json TEXT NOT NULL, text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','resolved')), updated_at TEXT NOT NULL,
    CHECK((user_id IS NULL) <> (guest_key_hash IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS place_feedback_user ON place_feedback(place_id,user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS place_feedback_guest ON place_feedback(place_id,guest_key_hash) WHERE guest_key_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS place_feedback_queue ON place_feedback(rating,status,updated_at);`);
  const identity = viewer => viewer?.userId ? ["user_id", viewer.userId] : viewer?.guestKeyHash ? ["guest_key_hash", viewer.guestKeyHash] : null;
  const mine = (placeId, viewer) => {
    const key = identity(viewer);
    return key ? db.prepare(`SELECT * FROM place_feedback WHERE place_id=? AND ${key[0]}=?`).get(placeId, key[1]) ?? null : null;
  };
  const view = row => row ? { rating: row.rating, issues: JSON.parse(row.issues_json), text: row.text, status: row.status, updatedAt: row.updated_at } : null;
  return {
    getPlaceFeedback(placeId, viewer) { return { mine: view(mine(placeId, viewer)) }; },
    savePlaceFeedback(place, viewer, input) {
      const key = identity(viewer);
      if (!key) throw badRequest();
      const clean = normalizePlaceFeedback(input);
      return transaction(() => {
        const previous = mine(place.id, viewer);
        if (clean.rating === null) {
          if (previous) db.prepare("DELETE FROM place_feedback WHERE id=?").run(previous.id);
        } else {
          const time = new Date(now()).toISOString();
          // A retry of the exact same vote must not reopen an editor-resolved request.
          const status = previous && previous.rating === clean.rating && previous.issues_json === JSON.stringify(clean.issues) && previous.text === clean.text ? previous.status : "open";
          if (previous) db.prepare("UPDATE place_feedback SET place_title=?,rating=?,issues_json=?,text=?,status=?,updated_at=? WHERE id=?")
            .run(place.name, clean.rating, JSON.stringify(clean.issues), clean.text, status, time, previous.id);
          else db.prepare(`INSERT INTO place_feedback(id,place_id,place_title,${key[0]},rating,issues_json,text,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
            .run(randomUUID(), place.id, place.name, key[1], clean.rating, JSON.stringify(clean.issues), clean.text, status, time);
        }
        return { mine: view(mine(place.id, viewer)) };
      });
    },
    listPlaceFeedbackAdmin({ limit = 25, offset = 0 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) throw badRequest();
      const where = "rating=-1 AND status='open'";
      const total = Number(db.prepare(`SELECT count(*) AS total FROM place_feedback WHERE ${where}`).get().total);
      const pageOffset = Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit);
      const items = db.prepare(`SELECT * FROM place_feedback WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(limit, pageOffset)
        .map(row => ({ id: row.id, place: { id: row.place_id, title: row.place_title }, ...view(row) }));
      return { items, total, offset: pageOffset, hasMore: pageOffset + items.length < total };
    },
    resolvePlaceFeedback(id) {
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw badRequest();
      return { resolved: Number(db.prepare("UPDATE place_feedback SET status='resolved' WHERE id=? AND status='open'").run(id).changes) };
    },
  };
}
