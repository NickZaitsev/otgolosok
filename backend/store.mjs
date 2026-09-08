import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { editorialDraft } from "./admin.mjs";
import { sha256 } from "./domain.mjs";

const STAGES = new Set([
  "queued",
  "researching",
  "verifying",
  "writing",
  "voicing",
  "ready",
  "insufficient_evidence",
  "review_required",
  "failed",
]);

const WORKING_STAGES = ["researching", "verifying", "writing", "voicing"];
const TERMINAL_STAGES = ["ready", "insufficient_evidence", "review_required", "failed"];

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isoNow(now) {
  return new Date(now()).toISOString();
}

function utcDayBounds(now) {
  const date = new Date(now());
  const start = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return [
    new Date(start).toISOString(),
    new Date(start + 86_400_000).toISOString(),
  ];
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function encode(record) {
  const json = JSON.stringify(record);
  if (json === undefined) {
    throw new TypeError("Record must be JSON-serializable");
  }
  return json;
}

function decode(row) {
  return row ? JSON.parse(row.record_json) : null;
}

export function createStore(
  databasePath,
  { now = Date.now, maxActive = 2, maxDaily = 6 } = {},
) {
  if (!Number.isInteger(maxActive) || maxActive < 0) {
    throw new TypeError("maxActive must be a non-negative integer");
  }
  if (!Number.isInteger(maxDaily) || maxDaily < 0) {
    throw new TypeError("maxDaily must be a non-negative integer");
  }

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  let closed = false;

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      job_key TEXT NOT NULL UNIQUE,
      stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_stage_idx ON jobs(stage);
    CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at);
    CREATE TABLE IF NOT EXISTS retries (created_at TEXT NOT NULL);
  `);

  const findById = db.prepare(
    "SELECT record_json FROM jobs WHERE id = ?",
  );
  const findByKey = db.prepare(
    "SELECT record_json FROM jobs WHERE job_key = ?",
  );
  const writeJob = db.prepare(`
    UPDATE jobs
    SET stage = ?, record_json = ?
    WHERE id = ?
  `);
  const insertJob = db.prepare(`
    INSERT INTO jobs (id, job_key, stage, created_at, record_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  function transaction(work) {
    let begun = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      begun = true;
      const value = work();
      db.exec("COMMIT");
      begun = false;
      return value;
    } catch (error) {
      if (begun) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Preserve the original database or application error.
        }
      }
      throw error;
    }
  }

  function save(record) {
    writeJob.run(record.stage, encode(record), record.id);
    return record;
  }

  function recoverInterrupted() {
    return transaction(() => {
      const placeholders = WORKING_STAGES.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT record_json
        FROM jobs
        WHERE stage IN (${placeholders})
      `).all(...WORKING_STAGES);

      for (const row of rows) {
        const record = decode(row);
        record.stage = "failed";
        record.revision += 1;
        record.updatedAt = isoNow(now);
        record.error = {
          code: "INTERRUPTED",
          message: "Подготовка прервалась. Можно повторить.",
        };
        save(record);
      }

      return rows.length;
    });
  }

  function checkCapacity() {
    const active = db.prepare(`SELECT count(*) AS count FROM jobs WHERE stage NOT IN (${TERMINAL_STAGES.map(() => "?").join(",")})`).get(...TERMINAL_STAGES).count;
    if (Number(active) >= maxActive) throw codedError("QUEUE_FULL");
    const [start, end] = utcDayBounds(now);
    const created = db.prepare("SELECT count(*) AS count FROM jobs WHERE created_at >= ? AND created_at < ?").get(start, end).count;
    const retries = db.prepare("SELECT count(*) AS count FROM retries WHERE created_at >= ? AND created_at < ?").get(start, end).count;
    if (Number(created) + Number(retries) >= maxDaily) throw codedError("DAILY_LIMIT");
  }

  return {
    createOrGet({ key, address }) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("key must be a non-empty string");
      }
      if (typeof address !== "string" || address.length === 0) {
        throw new TypeError("address must be a non-empty string");
      }

      return transaction(() => {
        const existing = decode(findByKey.get(key));
        if (existing) {
          return existing;
        }

        checkCapacity();

        const timestamp = isoNow(now);
        const record = {
          id: randomUUID(),
          key,
          address,
          stage: "queued",
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          data: {},
          error: null,
          attempts: 0,
        };

        insertJob.run(
          record.id,
          record.key,
          record.stage,
          record.createdAt,
          encode(record),
        );
        return record;
      });
    },

    get(id) {
      return decode(findById.get(id));
    },

    listAdmin({ limit = 50, offset = 0 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) throw codedError("BAD_REQUEST");
      const rows = db.prepare("SELECT record_json FROM jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(limit + 1, offset);
      return { jobs: rows.slice(0, limit).map(decode), hasMore: rows.length > limit };
    },

    editAdmin(id, expectedRevision, draft) {
      return transaction(() => {
        const job = decode(findById.get(id));
        if (!job) return null;
        if (job.revision !== expectedRevision || job.stage !== "review_required") throw codedError("CONFLICT");
        const valid = editorialDraft(job.data, draft);
        const editorDraft = { title: valid.title, paragraphs: valid.paragraphs };
        return save({ ...job, data: { ...job.data, editorDraft }, revision: job.revision + 1, updatedAt: isoNow(now) });
      });
    },

    approveAdmin(id, expectedRevision, ttsProvider = "openai") {
      if (!["openai", "yandex"].includes(ttsProvider)) throw codedError("BAD_REQUEST");
      return transaction(() => {
        const job = decode(findById.get(id));
        if (!job) return null;
        if (job.revision !== expectedRevision || job.stage !== "review_required") throw codedError("CONFLICT");
        const story = { ...editorialDraft(job.data), verification: "editorial" };
        checkCapacity();
        const timestamp = isoNow(now);
        db.prepare("INSERT INTO retries (created_at) VALUES (?)").run(timestamp);
        return save({ ...job, stage: "queued", error: null, revision: job.revision + 1, updatedAt: timestamp,
          data: { ...job.data, story, audio: null, ttsProvider, textReadyAt: timestamp,
            editorialApproval: { approvedAt: timestamp, revision: job.revision, ttsProvider, draftHash: sha256(JSON.stringify(job.data.editorDraft)), storyHash: sha256(JSON.stringify(story)) } } });
      });
    },

    retry(id, expectedRevision) {
      return transaction(() => {
        const job = decode(findById.get(id));
        if (!job) return null;
        // A repeated click while the same retry is queued must not enqueue again.
        if (!TERMINAL_STAGES.includes(job.stage)) return job;
        if (job.revision !== expectedRevision) throw codedError("CONFLICT");
        if (job.stage !== "failed" || job.attempts >= 3) throw codedError("RETRY_LIMIT");
        checkCapacity();
        const timestamp = isoNow(now);
        db.prepare("INSERT INTO retries (created_at) VALUES (?)").run(timestamp);
        return save({...job,stage:"queued",error:null,updatedAt:timestamp,revision:job.revision+1});
      });
    },

    update(id, patch, expectedRevision) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("patch must be an object");
      }

      if (has(patch, "stage") && !STAGES.has(patch.stage)) {
        throw new TypeError(`Invalid stage: ${patch.stage}`);
      }
      if (
        has(patch, "attempts")
        && (!Number.isInteger(patch.attempts) || patch.attempts < 0)
      ) {
        throw new TypeError("attempts must be a non-negative integer");
      }

      return transaction(() => {
        const current = decode(findById.get(id));
        if (!current) {
          return null;
        }
        if (current.revision !== expectedRevision) {
          throw codedError("CONFLICT", "Запись была изменена.");
        }

        const next = { ...current };
        for (const field of ["stage", "data", "error", "attempts"]) {
          if (has(patch, field)) {
            next[field] = patch[field];
          }
        }

        next.revision = current.revision + 1;
        next.updatedAt = isoNow(now);
        encode(next);
        return save(next);
      });
    },

    claimNext() {
      return transaction(() => {
        const working = db.prepare(`
          SELECT 1
          FROM jobs
          WHERE stage IN (${WORKING_STAGES.map(() => "?").join(", ")})
          LIMIT 1
        `).get(...WORKING_STAGES);

        if (working) {
          return null;
        }

        const row = db.prepare(`
          SELECT record_json
          FROM jobs
          WHERE stage = 'queued'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `).get();

        if (!row) {
          return null;
        }

        const record = decode(row);
        record.stage = "researching";
        record.attempts += 1;
        record.revision += 1;
        record.updatedAt = isoNow(now);
        return save(record);
      });
    },

    recoverInterrupted,

    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
