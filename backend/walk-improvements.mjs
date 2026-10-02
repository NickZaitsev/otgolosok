import { randomUUID } from "node:crypto";

/** What a viewer can ask to improve; the order is the order of the form and of the editor columns. */
export const IMPROVEMENT_ISSUES = ["short_text", "no_images", "voiceover"];
export const IMPROVEMENT_STATUSES = ["open", "resolved"];

const COLUMNS = { short_text: "issue_short_text", no_images: "issue_no_images", voiceover: "issue_voiceover" };
const badRequest = message => Object.assign(new Error(message), { code: "BAD_REQUEST" });

/** A set of known issue codes in canonical order; an empty list withdraws the request. */
export function normalizeIssues(value) {
  if (!Array.isArray(value) || value.length > IMPROVEMENT_ISSUES.length
    || value.some(issue => !IMPROVEMENT_ISSUES.includes(issue)) || new Set(value).size !== value.length) throw badRequest("Invalid improvement issues");
  return IMPROVEMENT_ISSUES.filter(issue => value.includes(issue));
}

const viewerColumn = viewer => viewer?.userId ? ["user_id", viewer.userId]
  : viewer?.guestKeyHash ? ["guest_key_hash", viewer.guestKeyHash] : null;
const issuesOf = row => IMPROVEMENT_ISSUES.filter(issue => row[COLUMNS[issue]] === 1);

/**
 * Improvement requests: one per viewer and walk, private to the editors, so no moderation.
 * Like reviews they cascade with the author's account and outlive the walk itself.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ now?: () => number, transaction: <T>(fn: () => T) => T }} options
 */
export function createWalkImprovementStore(db, { now = Date.now, transaction }) {
  db.exec(`CREATE TABLE IF NOT EXISTS walk_improvement_requests (
      id TEXT PRIMARY KEY,
      walk_kind TEXT NOT NULL CHECK(walk_kind IN ('catalog','account')),
      walk_id TEXT NOT NULL, walk_title TEXT NOT NULL, walk_revision INTEGER NOT NULL,
      user_id TEXT REFERENCES user(id) ON DELETE CASCADE, guest_key_hash TEXT,
      issue_short_text INTEGER NOT NULL CHECK(issue_short_text IN (0,1)),
      issue_no_images INTEGER NOT NULL CHECK(issue_no_images IN (0,1)),
      issue_voiceover INTEGER NOT NULL CHECK(issue_voiceover IN (0,1)),
      status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT,
      CHECK((user_id IS NULL) <> (guest_key_hash IS NULL)),
      CHECK(issue_short_text + issue_no_images + issue_voiceover > 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS walk_improvements_user ON walk_improvement_requests(walk_kind, walk_id, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS walk_improvements_guest ON walk_improvement_requests(walk_kind, walk_id, guest_key_hash) WHERE guest_key_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS walk_improvements_status ON walk_improvement_requests(status, walk_kind, walk_id);`);
  const timestamp = () => new Date(now()).toISOString();

  const findMine = (target, viewer) => {
    const column = viewerColumn(viewer);
    if (!column) return null;
    return db.prepare(`SELECT * FROM walk_improvement_requests WHERE walk_kind=? AND walk_id=? AND ${column[0]}=?`).get(target.kind, target.id, column[1]) ?? null;
  };
  const mineView = row => row ? { issues: issuesOf(row), status: row.status, updatedAt: row.updated_at } : null;

  return {
    getWalkImprovement(target, viewer) {
      return { mine: mineView(findMine(target, viewer)) };
    },

    /** Upsert; any send reopens a resolved request, since the viewer still sees the problem. */
    saveWalkImprovement(target, viewer, issues) {
      const column = viewerColumn(viewer);
      if (!column) throw badRequest("Requester is required");
      const clean = normalizeIssues(issues);
      return transaction(() => {
        const previous = findMine(target, viewer), time = timestamp();
        const flags = IMPROVEMENT_ISSUES.map(issue => clean.includes(issue) ? 1 : 0);
        if (!clean.length) {
          if (previous) db.prepare("DELETE FROM walk_improvement_requests WHERE id=?").run(previous.id);
        } else if (previous) {
          db.prepare(`UPDATE walk_improvement_requests SET issue_short_text=?, issue_no_images=?, issue_voiceover=?, status='open',
              resolved_at=NULL, resolved_by=NULL, walk_title=?, walk_revision=?, updated_at=? WHERE id=?`)
            .run(...flags, target.title, target.revision, time, previous.id);
        } else {
          db.prepare(`INSERT INTO walk_improvement_requests(id, walk_kind, walk_id, walk_title, walk_revision, ${column[0]},
              issue_short_text, issue_no_images, issue_voiceover, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,'open',?,?)`)
            .run(randomUUID(), target.kind, target.id, target.title, target.revision, column[1], ...flags, time, time);
        }
        return { mine: mineView(findMine(target, viewer)) };
      });
    },

    /** Requests grouped by walk, most requested first: editors fix walks, not single requests. */
    listWalkImprovementsAdmin({ status = "open", issue = null, q = "", limit = 25, offset = 0 } = {}) {
      if (![...IMPROVEMENT_STATUSES, "all"].includes(status)
        || (issue !== null && !IMPROVEMENT_ISSUES.includes(issue))
        || typeof q !== "string" || q.length > 120
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
        || !Number.isSafeInteger(offset) || offset < 0) throw badRequest("Invalid improvement filters");
      const where = [], params = [];
      if (status !== "all") { where.push("status=?"); params.push(status); }
      if (q.trim()) { where.push("instr(walk_search(walk_title), walk_search(?)) > 0"); params.push(q.trim()); }
      const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const having = issue ? `HAVING sum(${COLUMNS[issue]}) > 0` : "";
      const grouped = `SELECT walk_kind, walk_id, count(*) AS total,
          sum(issue_short_text) AS short_text, sum(issue_no_images) AS no_images, sum(issue_voiceover) AS voiceover,
          sum(status='open') AS open, max(updated_at) AS last_at
        FROM walk_improvement_requests ${filter} GROUP BY walk_kind, walk_id ${having}`;
      const total = Number(db.prepare(`SELECT count(*) AS total FROM (${grouped})`).get(...params).total);
      // Clamp in one query if resolving emptied the last page.
      const pageOffset = Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit);
      const rows = db.prepare(`SELECT g.*,
          (SELECT walk_title FROM walk_improvement_requests r WHERE r.walk_kind=g.walk_kind AND r.walk_id=g.walk_id ORDER BY updated_at DESC, id DESC LIMIT 1) AS title,
          CASE WHEN w.visibility IN ('shared','public') THEN w.share_token END AS share_token
        FROM (${grouped}) g LEFT JOIN user_walks w ON g.walk_kind='account' AND w.id=g.walk_id
        ORDER BY g.total DESC, g.last_at DESC, g.walk_kind, g.walk_id LIMIT ? OFFSET ?`).all(...params, limit, pageOffset);
      const walks = rows.map(row => ({
        walk: { kind: row.walk_kind, id: row.walk_id, title: row.title, shareToken: row.share_token ?? null },
        total: Number(row.total), open: Number(row.open), lastAt: row.last_at,
        issues: Object.fromEntries(IMPROVEMENT_ISSUES.map(key => [key, Number(row[key])])),
      }));
      const open = Number(db.prepare("SELECT count(*) AS count FROM walk_improvement_requests WHERE status='open'").get().count);
      return { walks, total, offset: pageOffset, hasMore: pageOffset + walks.length < total, open };
    },

    /** Marks every open request of a walk resolved; returns how many changed. */
    resolveWalkImprovements(kind, id, editorId = null) {
      if (!["catalog", "account"].includes(kind) || typeof id !== "string" || !id || id.length > 128) throw badRequest("Invalid walk");
      return Number(db.prepare("UPDATE walk_improvement_requests SET status='resolved', resolved_at=?, resolved_by=? WHERE walk_kind=? AND walk_id=? AND status='open'")
        .run(timestamp(), editorId, kind, id).changes);
    },
  };
}
