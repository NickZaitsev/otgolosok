import { isDeepStrictEqual } from "node:util";
import { contentSourceHash, requireContentLocale } from "./content-localization.mjs";
import { failure } from "./domain.mjs";
import { hydratePlaceTranslation, hydrateWalkTranslation, validateEditorialSourceStory } from "./place-translations.mjs";
import { validateWalkDocument } from "./walk-document.mjs";

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactFields = (value, fields) => record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
const bad = message => failure("BAD_REQUEST", message);
const conflict = message => failure("CONFLICT", message);

function validateCapturedSource(source) {
  if (!record(source) || source.version !== 1 || !Array.isArray(source.entries) || source.entries.length === 0 ||
      typeof source.sourceDocumentSha256 !== "string" || !HASH.test(source.sourceDocumentSha256)) {
    throw bad("Некорректный снимок исходных текстов.");
  }
  validateWalkDocument(source.document);
  if (contentSourceHash(source.document) !== source.sourceDocumentSha256) {
    throw conflict("Хеш документа не соответствует зафиксированному снимку.");
  }
  const places = new Set();
  const texts = new Set();
  for (const entry of source.entries) {
    if (!record(entry) || typeof entry.placeId !== "string" || typeof entry.sourceTextId !== "string" ||
        typeof entry.sourceStorySha256 !== "string" || !HASH.test(entry.sourceStorySha256) || !record(entry.story) ||
        places.has(entry.placeId) || texts.has(entry.sourceTextId)) {
      throw bad("Некорректная запись в снимке исходных текстов.");
    }
    if (contentSourceHash(entry.story) !== entry.sourceStorySha256) {
      throw conflict(`Хеш истории не соответствует снимку: ${entry.placeId}.`);
    }
    places.add(entry.placeId);
    texts.add(entry.sourceTextId);
  }
  return contentSourceHash(source);
}

function validatePairedSource(source, baseSource) {
  if (source.sourceKind !== undefined && source.sourceKind !== "editorial") {
    throw bad("Неизвестный вид снимка исходных текстов.");
  }
  if (source.sourceKind !== "editorial") return [];
  if (!record(baseSource) || baseSource.sourceKind !== undefined) {
    throw bad("Для редакционного снимка требуется исходный опубликованный снимок.");
  }
  const baseSourceBundleSha256 = validateCapturedSource(baseSource);
  if (source.baseSourceBundleSha256 !== baseSourceBundleSha256) {
    throw conflict("Хеш опубликованного снимка не соответствует редакционной поправке.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.editedAt) ||
      source.baseCapturedAt !== baseSource.capturedAt || source.baseSourceUrl !== baseSource.sourceUrl ||
      source.capturedAt !== undefined || source.sourceUrl !== undefined ||
      source.shareToken !== baseSource.shareToken || source.revision !== baseSource.revision ||
      source.sourceDocumentSha256 !== baseSource.sourceDocumentSha256 ||
      !isDeepStrictEqual(source.document, baseSource.document) ||
      source.entries.length !== baseSource.entries.length) {
    throw conflict("Редакционный снимок не соответствует опубликованной основе.");
  }

  const sourceEdits = [];
  const targetIds = new Set(baseSource.entries.map(entry => entry.sourceTextId));
  for (let index = 0; index < source.entries.length; index++) {
    const edited = source.entries[index];
    const base = baseSource.entries[index];
    if (edited.placeId !== base.placeId) throw conflict(`Нарушен порядок исходных историй: позиция ${index + 1}.`);
    if (edited.sourceEdit === undefined) {
      if (!isDeepStrictEqual(edited, base)) throw conflict(`История без sourceEdit изменена: ${edited.placeId}.`);
      continue;
    }
    if (!exactFields(edited.sourceEdit, ["baseSourceTextId", "baseSourceStorySha256"]) ||
        edited.sourceEdit.baseSourceTextId !== base.sourceTextId ||
        edited.sourceEdit.baseSourceStorySha256 !== base.sourceStorySha256 ||
        !UUID.test(edited.sourceEdit.baseSourceTextId) || !UUID.test(edited.sourceTextId) || targetIds.has(edited.sourceTextId)) {
      throw conflict(`Некорректная привязка редакционной поправки: ${edited.placeId}.`);
    }
    const expected = {
      ...base,
      sourceTextId: edited.sourceTextId,
      sourceStorySha256: edited.sourceStorySha256,
      sourceEdit: edited.sourceEdit,
      story: edited.story,
    };
    if (!isDeepStrictEqual(edited, expected)) {
      throw conflict(`Редакционная поправка изменила служебные поля: ${edited.placeId}.`);
    }
    validateEditorialSourceStory(base.story, edited.story);
    targetIds.add(edited.sourceTextId);
    sourceEdits.push({
      placeId: edited.placeId,
      sourceTextId: edited.sourceTextId,
      sourceStorySha256: edited.sourceStorySha256,
      baseSourceTextId: base.sourceTextId,
      baseSourceStorySha256: base.sourceStorySha256,
      story: edited.story,
    });
  }
  if (!sourceEdits.length) throw bad("Редакционный снимок не содержит поправок.");
  return sourceEdits;
}

function validateLocaleArtifact(source, artifact, sourceBundleSha256) {
  if (!exactFields(artifact, ["version", "locale", "status", "sourceBundleSha256", "entries", "walk"]) ||
      artifact.version !== 1 || artifact.status !== "draft" || !Array.isArray(artifact.entries) ||
      artifact.entries.length !== source.entries.length || artifact.sourceBundleSha256 !== sourceBundleSha256) {
    if (record(artifact) && typeof artifact.sourceBundleSha256 === "string" &&
        artifact.sourceBundleSha256 !== sourceBundleSha256) {
      throw conflict("Перевод создан для другого снимка исходных текстов.");
    }
    throw bad("Некорректный файл перевода.");
  }
  const locale = requireContentLocale(artifact.locale);
  if (locale === "ru") throw bad("Русский исходный текст не является переводом.");

  const entries = artifact.entries.map((entry, index) => {
    const original = source.entries[index];
    if (!exactFields(entry, ["placeId", "sourceTextId", "sourceStorySha256", "title", "paragraphs", "facts"]) ||
        entry.placeId !== original.placeId || entry.sourceTextId !== original.sourceTextId ||
        entry.sourceStorySha256 !== original.sourceStorySha256) {
      throw conflict(`Перевод истории не соответствует снимку: позиция ${index + 1}.`);
    }
    return {
      placeId: original.placeId,
      sourceTextId: original.sourceTextId,
      sourceStorySha256: original.sourceStorySha256,
      story: hydratePlaceTranslation(original.story, entry),
    };
  });

  if (!exactFields(artifact.walk, ["sourceDocumentSha256", "title", "description", "stops"]) ||
      artifact.walk.sourceDocumentSha256 !== source.sourceDocumentSha256) {
    throw conflict("Перевод прогулки создан для другого документа.");
  }
  const walkContent = hydrateWalkTranslation(source.document, artifact.walk);
  return {
    locale,
    walkContent,
    entries,
    provenance: { method: "machine", author: "Codex", provider: "OpenAI" },
  };
}

/**
 * Builds a fully hydrated, source-pinned batch without consulting mutable live data.
 * The store performs its own freshness checks when this batch is applied.
 */
/** @param {any} source @param {any[]} translations @param {{baseSource?: any}} [options] */
export function validateTranslationBundle(source, translations, { baseSource } = {}) {
  const sourceBundleSha256 = validateCapturedSource(source);
  const sourceEdits = validatePairedSource(source, baseSource);
  if (!Array.isArray(translations) || translations.length === 0) throw bad("Не переданы файлы переводов.");
  const seen = new Set();
  const hydrated = translations.map(artifact => {
    const item = validateLocaleArtifact(source, artifact, sourceBundleSha256);
    if (seen.has(item.locale)) throw bad(`Локаль ${item.locale} указана больше одного раза.`);
    seen.add(item.locale);
    return item;
  });
  if (sourceEdits.length && (seen.size !== 2 || !seen.has("en") || !seen.has("zh"))) {
    throw bad("Редакционная поправка русского исходника требует английский и китайский черновики.");
  }
  return {
    document: source.document,
    sourceDocumentSha256: source.sourceDocumentSha256,
    sourceEdits,
    translations: hydrated,
  };
}
