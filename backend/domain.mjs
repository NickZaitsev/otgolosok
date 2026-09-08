import { createHash } from "node:crypto";

export const PIPELINE_VERSION = "place-history-v3";
export const TERMINAL = new Set(["ready", "failed", "insufficient_evidence", "review_required"]);
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export function failure(code, message = code) { return Object.assign(new Error(message), { code }); }

export function normalizeAddress(value) {
  if (typeof value !== "string") throw failure("INVALID_ADDRESS");
  const address = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (address.length < 6 || address.length > 180 || !/\d/.test(address) ||
      !/^[\p{L}\p{N}\s.,/()№–—-]+$/u.test(address) || /^[-\d.,\s]+$/.test(address)) throw failure("INVALID_ADDRESS");
  return /москва/iu.test(address) ? address : `Москва, ${address}`;
}

export function addressKey(address) {
  return sha256(`${PIPELINE_VERSION}|ru|${address.toLocaleLowerCase("ru").replace(/ё/g, "е")
    .replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()}`);
}

export function parseModelJson(text) {
  if (typeof text !== "string" || text.length > 65000) throw failure("INVALID_MODEL_OUTPUT");
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (match?.[1] ?? text).trim();
  try {
    const value = JSON.parse(candidate);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw failure("INVALID_MODEL_OUTPUT"); }
}

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", laquo: "«", raquo: "»", hellip: "…" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? all;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  });
}

export function pageText(html) {
  const clean = html.replace(/<(script|style|noscript|svg|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const main = /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)\s*>/i.exec(clean)?.[1];
  return decodeEntities(main ?? clean).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 22000);
}

export function comparable(text) {
  return text.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
    .replace(/[«»“”„]/g, '"').replace(/[–—]/g, "-").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

const shortText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** Quotes must exist in the fetched page, not merely in a search snippet. */
export function validateFacts(result, sources, { requireEditorialScope = false } = {}) {
  if (result.addressConfirmed !== true) throw failure("ADDRESS_UNCLEAR");
  if (!shortText(result.placeName, 160) || !shortText(result.resolvedAddress, 200) || !Array.isArray(result.facts)) throw failure("INVALID_MODEL_OUTPUT");
  const seen = new Set();
  const facts = result.facts.slice(0, 8).flatMap((fact) => {
    if (!/^f[1-8]$/.test(fact?.id) || seen.has(fact.id) || !shortText(fact.claim, 600) || !Array.isArray(fact.evidence)) return [];
    // Legacy editorial checkpoints remain editable. New research must classify
    // every fact; excluded or unlocated material cannot fill the five-fact quota.
    const scoped = requireEditorialScope || ["topic", "scope", "location", "distanceMeters"].some(key => Object.hasOwn(fact, key));
    if (scoped && (!["architecture", "place_history"].includes(fact.topic) ||
        !["building", "site", "nearby"].includes(fact.scope) || !shortText(fact.location, 240) ||
        (fact.scope === "nearby" && (!Number.isFinite(fact.distanceMeters) || fact.distanceMeters <= 0 || fact.distanceMeters > 300)))) return [];
    const evidence = fact.evidence.slice(0, 3).filter((proof) => {
      const source = sources.find((item) => item.id === proof?.sourceId);
      return source && shortText(proof.quote, 500) && proof.quote.trim().length >= 18 &&
        comparable(source.text).includes(comparable(proof.quote));
    });
    if (!evidence.length) return [];
    seen.add(fact.id);
    return [{ id: fact.id, claim: fact.claim, interesting: fact.interesting === true,
      ...(scoped ? {topic:fact.topic,scope:fact.scope,location:fact.location.trim(),distanceMeters:fact.scope === "nearby" ? fact.distanceMeters : null} : {}),
      evidence: evidence.map(({sourceId, quote}) => ({sourceId, quote})) }];
  });
  const used = new Set(facts.flatMap((fact) => fact.evidence.map((proof) => proof.sourceId)));
  const publishers = new Set(sources.filter((source) => used.has(source.id)).map((source) => source.publisher));
  if (facts.length < 5 || publishers.size < 2) throw failure("INSUFFICIENT_EVIDENCE");
  return { placeName: result.placeName.trim(), resolvedAddress: result.resolvedAddress.trim(), facts,
    sources: sources.filter((source) => used.has(source.id)) };
}

export function validateDraft(draft, evidence) {
  if (!shortText(draft.title, 140) || !Array.isArray(draft.paragraphs) || draft.paragraphs.length < 2 || draft.paragraphs.length > 6) throw failure("INVALID_DRAFT");
  const factIds = new Set(evidence.facts.map((fact) => fact.id));
  const used = new Set();
  const paragraphs = draft.paragraphs.map((paragraph) => {
    if (!shortText(paragraph?.text, 2000) || !Array.isArray(paragraph.factIds) || !paragraph.factIds.length ||
        !paragraph.factIds.every((id) => factIds.has(id))) throw failure("INVALID_DRAFT");
    paragraph.factIds.forEach((id) => used.add(id));
    return { text: paragraph.text.trim(), factIds: [...new Set(paragraph.factIds)] };
  });
  const script = paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  const wordCount = script.split(/\s+/).length;
  if (wordCount < 100 || wordCount > 250 || used.size < 5) throw failure("INVALID_DRAFT", `Expected 100-250 words and at least 5 distinct facts; got ${wordCount} words and ${used.size} facts.`);
  return { title: draft.title.trim(), address: evidence.resolvedAddress, paragraphs, wordCount,
    verification: "automatic", sources: evidence.sources.map(({ id, url, title, publisher }) => ({id, url, title, publisher})),
    facts: evidence.facts.filter((fact) => used.has(fact.id)).map((fact) => ({id: fact.id, claim: fact.claim, sourceIds: fact.evidence.map((proof) => proof.sourceId)})) };
}

export function publicJob(job) {
  return { id: job.id, address: job.address, stage: job.stage, revision: job.revision,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
    story: job.data.story ?? null, audio: job.data.audio ?? null,
    elapsedSec: TERMINAL.has(job.stage) && job.data.elapsedSec !== undefined ? job.data.elapsedSec : Math.round((Date.now() - Date.parse(job.createdAt)) / 1000),
    error: job.error, canRetry: job.stage === "failed" && job.attempts < 3 };
}
