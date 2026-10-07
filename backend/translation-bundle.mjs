import { isDeepStrictEqual } from "node:util";
import { contentSourceHash, requireContentLocale } from "./content-localization.mjs";
import { failure } from "./domain.mjs";
import { hydratePlaceTranslation, hydrateWalkTranslation } from "./place-translations.mjs";
import { validateWalkDocument } from "./walk-document.mjs";

const HASH = /^[a-f0-9]{64}$/;
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
export function validateTranslationBundle(source, translations) {
  const sourceBundleSha256 = validateCapturedSource(source);
  if (!Array.isArray(translations) || translations.length === 0) throw bad("Не переданы файлы переводов.");
  const seen = new Set();
  const hydrated = translations.map(artifact => {
    const item = validateLocaleArtifact(source, artifact, sourceBundleSha256);
    if (seen.has(item.locale)) throw bad(`Локаль ${item.locale} указана больше одного раза.`);
    seen.add(item.locale);
    return item;
  });
  return {
    document: source.document,
    sourceDocumentSha256: source.sourceDocumentSha256,
    translations: hydrated,
  };
}
