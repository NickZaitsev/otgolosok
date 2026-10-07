import { createHash } from "node:crypto";
import { failure } from "./domain.mjs";

export const CONTENT_LOCALES = Object.freeze(["ru", "en", "zh"]);
export function requireContentLocale(value) {
  if (!CONTENT_LOCALES.includes(value)) throw failure("BAD_REQUEST");
  return value;
}
/** Locale belongs to the URL representation, never to a mutable global or a cookie. */
export function readContentLocale(params) {
  const values = params.getAll("lang");
  if (values.length > 1) throw failure("BAD_REQUEST");
  return values.length ? requireContentLocale(values[0]) : "ru";
}
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
/** Stable across JSON object key ordering; includes facts, citations and editorial metadata. */
export function contentSourceHash(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
