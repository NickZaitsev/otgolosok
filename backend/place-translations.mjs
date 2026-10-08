import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { failure } from "./domain.mjs";
import { contentSourceHash, requireContentLocale } from "./content-localization.mjs";
import { safeWalkStory } from "./walk-view.mjs";
import { validateWalkDocument } from "./walk-document.mjs";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, limit, empty = false) => typeof value === "string" && value.length <= limit && (empty || value.trim().length > 0) && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const foreign = locale => { requireContentLocale(locale); if (locale === "ru") throw failure("BAD_REQUEST"); return locale; };
const same = (a, b) => isDeepStrictEqual(a, b);
const HASH = /^[a-f0-9]{64}$/;

/** Only editorial text changes. IDs, fact links, source URLs, citations and address remain source-owned. */
export function validatePlaceTranslation(source, value) {
  const original = safeWalkStory({ story: source, address: source.address });
  const translated = safeWalkStory({ story: value, address: value?.address });
  if (!original || !translated || !same(translated, value) || translated.address !== original.address ||
      !same(translated.sources, original.sources) || translated.checkedAt !== original.checkedAt ||
      translated.paragraphs.length !== original.paragraphs.length || translated.facts.length !== original.facts.length ||
      translated.paragraphs.some((paragraph, i) => !same(paragraph.factIds, original.paragraphs[i].factIds)) ||
      translated.facts.some((fact, i) => fact.id !== original.facts[i].id || !same(fact.sourceIds, original.facts[i].sourceIds))) throw failure("BAD_REQUEST");
  return translated;
}

/** A Russian editorial revision may change only the same narrative fields as a translation. */
export function validateEditorialSourceStory(source, value) {
  const original = safeWalkStory({ story: source, address: source?.address });
  const edited = safeWalkStory({ story: value, address: value?.address });
  if (!original || !edited) throw failure("BAD_REQUEST");
  validatePlaceTranslation(original, edited);
  const expected = {
    ...source,
    title: value.title,
    paragraphs: source.paragraphs.map((paragraph, index) => ({ ...paragraph, text: value.paragraphs[index].text })),
    facts: source.facts.map((fact, index) => ({ ...fact, claim: value.facts[index].claim })),
  };
  if (!same(expected, value)) throw failure("BAD_REQUEST");
  return value;
}

/** Compact translation files cannot change any non-text source field. */
export function hydratePlaceTranslation(source, draft) {
  const original = safeWalkStory({ story: source, address: source.address });
  if (!original || !record(draft) || !Array.isArray(draft.paragraphs) || draft.paragraphs.length !== original.paragraphs.length ||
      !record(draft.facts) || !same(Object.keys(draft.facts).sort(), original.facts.map(fact => fact.id).sort())) throw failure("BAD_REQUEST");
  return validatePlaceTranslation(source, { ...original, title: draft.title,
    paragraphs: original.paragraphs.map((paragraph, i) => ({ ...paragraph, text: draft.paragraphs[i] })),
    facts: original.facts.map(fact => ({ ...fact, claim: draft.facts[fact.id] })) });
}

export function hydrateWalkTranslation(document, value) {
  validateWalkDocument(document);
  if (!record(value) || !text(value.title, 120) || !text(value.description, 1000, true) ||
      !Array.isArray(value.stops) || value.stops.length !== document.stops.length ||
      value.stops.some((stop, i) => !record(stop) || stop.id !== document.stops[i].id || !text(stop.transition, 1200, true) || !text(stop.nextHint, 1200, true))) throw failure("BAD_REQUEST");
  return { title: value.title, description: value.description,
    stops: value.stops.map(stop => ({ id: stop.id, transition: stop.transition, nextHint: stop.nextHint })) };
}

const provenance = value => {
  if (!record(value) || !["editorial", "human", "machine"].includes(value.method) || !text(value.author, 128) ||
      Object.keys(value).some(key => !["method", "author", "provider", "model"].includes(key)) ||
      [value.provider, value.model].some(field => field !== undefined && !text(field, 128))) throw failure("BAD_REQUEST");
  return value;
};
const view = row => row ? { id: row.id, placeId: row.entity_id, locale: row.locale, sourceTextId: row.source_id,
  sourceStorySha256: row.source_hash, revision: Number(row.revision), state: row.state, staleReason: row.stale_reason,
  story: JSON.parse(row.content_json), contentHash: row.content_hash, provenance: JSON.parse(row.provenance_json),
  audio: row.audio_json ? JSON.parse(row.audio_json) : null, createdAt: row.created_at, approvedAt: row.approved_at, reviewer: row.reviewer } : null;

/** Translation tables are additive; an explicitly authorized bundle may add a pinned Russian editorial revision. */
export function createPlaceTranslationStore({ db, now, transaction, prepareEditorialSources }) {
  for (const table of ["place_story_translations", "walk_text_translations"]) db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('en','zh')),
    source_id TEXT NOT NULL, source_hash TEXT NOT NULL, revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('draft','approved','stale')), stale_reason TEXT,
    content_json TEXT NOT NULL, content_hash TEXT NOT NULL, provenance_json TEXT NOT NULL, audio_json TEXT,
    created_at TEXT NOT NULL, approved_at TEXT, reviewer TEXT,
    UNIQUE(entity_id,locale,revision));
    CREATE INDEX IF NOT EXISTS ${table}_lookup ON ${table}(entity_id,locale,source_id,state);`);
  const timestamp = () => new Date(now()).toISOString();
  const currentSource = placeId => db.prepare(`SELECT t.* FROM place_texts t JOIN places p ON p.id=t.place_id
    WHERE p.id=? AND p.archived=0 AND t.approved_story_json IS NOT NULL ORDER BY t.created_at DESC,t.rowid DESC LIMIT 1`).get(placeId);
  const checkSource = (row, expectedId, expectedHash) => {
    if (!row || row.id !== expectedId || contentSourceHash(JSON.parse(row.approved_story_json)) !== expectedHash) throw failure("CONFLICT");
  };
  function save(table, entityId, sourceId, sourceHash, locale, content, sourceProvenance) {
    foreign(locale); provenance(sourceProvenance);
    const contentHash = contentSourceHash(content);
    const existing = db.prepare(`SELECT * FROM ${table} WHERE entity_id=? AND locale=? AND source_id=? AND source_hash=? AND content_hash=? AND state IN ('draft','approved') ORDER BY revision DESC LIMIT 1`)
      .get(entityId, locale, sourceId, sourceHash, contentHash);
    if (existing) return view(existing);
    const revision = Number(db.prepare(`SELECT coalesce(max(revision),0)+1 n FROM ${table} WHERE entity_id=? AND locale=?`).get(entityId, locale).n);
    db.prepare(`UPDATE ${table} SET state='stale',stale_reason='translation_replaced' WHERE entity_id=? AND locale=? AND state='draft'`).run(entityId, locale);
    const id = randomUUID();
    db.prepare(`INSERT INTO ${table} (id,entity_id,locale,source_id,source_hash,revision,state,content_json,content_hash,provenance_json,created_at)
      VALUES (?,?,?,?,?,?,'draft',?,?,?,?)`).run(id, entityId, locale, sourceId, sourceHash, revision, JSON.stringify(content), contentHash, JSON.stringify(sourceProvenance), timestamp());
    return view(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  }
  function approve(table, id, expectedRevision, reviewer, sourceCheck) {
    if (!Number.isSafeInteger(expectedRevision) || !text(reviewer, 128)) throw failure("BAD_REQUEST");
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row || row.revision !== expectedRevision || row.state === "stale") throw failure("CONFLICT");
    sourceCheck(row);
    if (row.state === "approved") return view(row);
    db.prepare(`UPDATE ${table} SET state='stale',stale_reason='translation_replaced' WHERE entity_id=? AND locale=? AND state='approved'`).run(row.entity_id, row.locale);
    db.prepare(`UPDATE ${table} SET state='approved',approved_at=?,reviewer=? WHERE id=?`).run(timestamp(), reviewer, id);
    return view(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  }
  const latest = (table, entityId, locale) => db.prepare(`SELECT * FROM ${table} WHERE entity_id=? AND locale=? ORDER BY revision DESC LIMIT 1`)
    .get(entityId, locale);
  const exactDraft = (table, entityId, sourceId, sourceHash, locale, content, sourceProvenance) => {
    const row = latest(table, entityId, locale);
    return row?.state === "draft" && row.source_id === sourceId && row.source_hash === sourceHash &&
      row.content_hash === contentSourceHash(content) && same(JSON.parse(row.content_json), content) &&
      same(JSON.parse(row.provenance_json), sourceProvenance) ? row : null;
  };
  return {
    savePlaceTranslation(placeId, input) { return transaction(() => {
      const row = currentSource(placeId); checkSource(row, input.sourceTextId, input.sourceStorySha256);
      const story = validatePlaceTranslation(JSON.parse(row.approved_story_json), input.story);
      return save("place_story_translations", placeId, row.id, input.sourceStorySha256, input.locale, story, input.provenance);
    }); },
    approvePlaceTranslation(id, { expectedRevision, reviewer }) { return transaction(() => approve("place_story_translations", id, expectedRevision, reviewer,
      row => checkSource(currentSource(row.entity_id), row.source_id, row.source_hash))); },
    getPlaceTranslations(placeId) {
      return db.prepare("SELECT * FROM place_story_translations WHERE entity_id=? ORDER BY locale,revision").all(placeId).map(row => {
        const source = currentSource(placeId);
        const fresh = source && source.id === row.source_id && contentSourceHash(JSON.parse(source.approved_story_json)) === row.source_hash;
        return { ...view(row), ...(!fresh ? { state: "stale", staleReason: "source_changed" } : {}) };
      });
    },
    invalidatePlaceTranslations(placeId, currentSourceId) {
      db.prepare("UPDATE place_story_translations SET state='stale',stale_reason='source_changed' WHERE entity_id=? AND source_id<>? AND state<>'stale'")
        .run(placeId, currentSourceId);
    },
    localizePublishedPlace(place, locale) {
      requireContentLocale(locale);
      if (locale === "ru" || !place) return place;
      const rows = this.getPlaceTranslations(place.id).filter(row => row.locale === locale);
      const selected = rows.findLast(row => row.state === "approved" && row.sourceTextId === place.text.id && row.sourceStorySha256 === contentSourceHash(place.text.story));
      const reason = selected ? null : rows.some(row => row.state === "draft") ? "draft" : rows.length ? "stale" : "missing";
      const localization = { requestedLocale: locale, contentLocale: selected ? locale : "ru", fallbackReason: reason };
      const audio = selected ? selected.audio : place.text.audio;
      return { ...place, text: { ...place.text, ...(selected ? { id: selected.id, story: selected.story, verification: "editorial_translation" } : {}),
        audio: audio ? { ...audio, language: localization.contentLocale } : null, localization,
        sourceRevision: place.text.id, ...(selected ? { translationRevision: selected.revision, translationContentHash: selected.contentHash } : {}) } };
    },
    savePlaceTranslationAudio(id, audio, { expectedRevision, voice }) { return transaction(() => {
      const row = db.prepare("SELECT * FROM place_story_translations WHERE id=?").get(id);
      if (!row || row.state !== "approved" || row.revision !== expectedRevision) throw failure("CONFLICT");
      checkSource(currentSource(row.entity_id), row.source_id, row.source_hash);
      if (!record(audio) || audio.language !== row.locale || audio.sourceTranslationId !== row.id || audio.sourceStorySha256 !== row.source_hash ||
          audio.translationHash !== row.content_hash || audio.provider !== "elevenlabs" || audio.model !== "eleven_v4" || !text(voice, 128) || audio.voice !== voice ||
          typeof audio.sha256 !== "string" || !HASH.test(audio.sha256) || audio.url !== `/api/story-audio/${audio.sha256}.mp3` ||
          !Number.isSafeInteger(audio.bytes) || audio.bytes < 1 || !Number.isFinite(audio.durationSec) || audio.durationSec <= 0 || audio.durationSec > 300 || audio.synthetic !== true) throw failure("BAD_REQUEST");
      db.prepare("UPDATE place_story_translations SET audio_json=? WHERE id=?").run(JSON.stringify(audio), id);
      return view(db.prepare("SELECT * FROM place_story_translations WHERE id=?").get(id));
    }); },
    saveWalkTranslation(document, { locale, content, provenance: sourceProvenance, sourceHash }) { return transaction(() => {
      validateWalkDocument(document);
      if (contentSourceHash(document) !== sourceHash) throw failure("CONFLICT");
      return save("walk_text_translations", document.id, document.id, sourceHash, locale, hydrateWalkTranslation(document, content), sourceProvenance);
    }); },
    approveWalkTranslation(id, { document, expectedRevision, reviewer }) { return transaction(() => approve("walk_text_translations", id, expectedRevision, reviewer, row => {
      validateWalkDocument(document); if (document.id !== row.entity_id || contentSourceHash(document) !== row.source_hash) throw failure("CONFLICT");
    })); },
    importTranslationBundle(batch, { applySourceEdits = false } = {}) { return transaction(() => {
      if (!record(batch) || (batch.sourceEdits !== undefined && !Array.isArray(batch.sourceEdits)) ||
          !Array.isArray(batch.translations) || !batch.translations.length ||
          typeof applySourceEdits !== "boolean") throw failure("BAD_REQUEST");
      const sourceEdits = batch.sourceEdits ?? [];
      validateWalkDocument(batch.document);
      if (contentSourceHash(batch.document) !== batch.sourceDocumentSha256) throw failure("CONFLICT");
      if (sourceEdits.length && !applySourceEdits) throw failure("BAD_REQUEST", "Редакционные поправки исходника требуют явного разрешения.");
      if (sourceEdits.length && typeof prepareEditorialSources !== "function") throw failure("CONFLICT");
      const sourcePlan = sourceEdits.length ? prepareEditorialSources(sourceEdits) : null;
      const edits = new Map(sourceEdits.map(edit => [edit.placeId, edit]));
      if (edits.size !== sourceEdits.length) throw failure("BAD_REQUEST");
      const locales = new Set();
      const prepared = batch.translations.map(translation => {
        const locale = foreign(translation.locale);
        provenance(translation.provenance);
        if (locales.has(locale) || !Array.isArray(translation.entries) || !translation.entries.length) throw failure("BAD_REQUEST");
        locales.add(locale);
        const places = new Set();
        const entries = translation.entries.map(entry => {
          if (!record(entry) || places.has(entry.placeId)) throw failure("BAD_REQUEST");
          places.add(entry.placeId);
          const edit = edits.get(entry.placeId);
          if (edit) {
            if (entry.sourceTextId !== edit.sourceTextId || entry.sourceStorySha256 !== edit.sourceStorySha256) throw failure("CONFLICT");
            return { ...entry, story: validatePlaceTranslation(edit.story, entry.story) };
          }
          const source = currentSource(entry.placeId);
          checkSource(source, entry.sourceTextId, entry.sourceStorySha256);
          return { ...entry, story: validatePlaceTranslation(JSON.parse(source.approved_story_json), entry.story) };
        });
        if ([...edits.keys()].some(placeId => !places.has(placeId))) throw failure("CONFLICT");
        return { ...translation, locale, entries, walkContent: hydrateWalkTranslation(batch.document, translation.walkContent) };
      });
      if (sourceEdits.length && (locales.size !== 2 || !locales.has("en") || !locales.has("zh"))) throw failure("BAD_REQUEST");

      if (sourcePlan?.state === "replay") {
        return prepared.map(translation => {
          const entries = translation.entries.map(entry => {
            const row = exactDraft("place_story_translations", entry.placeId, entry.sourceTextId, entry.sourceStorySha256,
              translation.locale, entry.story, translation.provenance);
            if (!row) throw failure("CONFLICT");
            return view(row);
          });
          const walk = exactDraft("walk_text_translations", batch.document.id, batch.document.id, batch.sourceDocumentSha256,
            translation.locale, translation.walkContent, translation.provenance);
          if (!walk) throw failure("CONFLICT");
          return { locale: translation.locale, entries, walk: view(walk) };
        });
      }

      sourcePlan?.apply();
      const result = [];
      for (const translation of prepared) {
        const entries = translation.entries.map(entry => {
          const source = currentSource(entry.placeId);
          checkSource(source, entry.sourceTextId, entry.sourceStorySha256);
          return save("place_story_translations", entry.placeId, source.id, entry.sourceStorySha256, translation.locale,
            entry.story, translation.provenance);
        });
        const walk = save("walk_text_translations", batch.document.id, batch.document.id, batch.sourceDocumentSha256,
          translation.locale, translation.walkContent, translation.provenance);
        result.push({ locale: translation.locale, entries, walk });
      }
      return result;
    }); },
    getWalkLocalization(document, locale) {
      requireContentLocale(locale);
      if (locale === "ru") return { document, localization: { requestedLocale: locale, contentLocale: locale, fallbackReason: null } };
      const rows = db.prepare("SELECT * FROM walk_text_translations WHERE entity_id=? AND locale=? ORDER BY revision DESC").all(document.id, locale);
      const hash = contentSourceHash(document);
      const row = rows.find(row => row.source_hash === hash && row.state === "approved");
      const fallbackReason = row ? null : rows.some(row => row.source_hash === hash && row.state === "draft") ? "draft" : rows.length ? "stale" : "missing";
      const localization = { requestedLocale: locale, contentLocale: row ? locale : "ru", fallbackReason };
      if (!row) return { document, localization };
      const content = hydrateWalkTranslation(document, JSON.parse(row.content_json));
      return { document: validateWalkDocument({ ...document, title: content.title, description: content.description,
        stops: document.stops.map((stop, i) => ({ ...stop, transition: content.stops[i].transition, nextHint: content.stops[i].nextHint })) }), localization };
    },
    localizeWalkDocument(document, locale) { return this.getWalkLocalization(document, locale).document; },
  };
}
