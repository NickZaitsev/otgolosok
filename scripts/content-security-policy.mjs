import { createHash } from "node:crypto";

// Static export has no request-time nonce, so inline bootstrap scripts are
// allowed by hash. frame-ancestors is ignored in <meta>; ingress sends it.
// Exact collector origins from Yandex's CSP documentation (no wildcard hosts).
const collectors = [
  "ru", "az", "by", "co.il", "com", "com.am", "com.ge", "com.tr", "ee",
  "fr", "kg", "kz", "lt", "lv", "md", "tj", "tm", "uz",
].map(zone => `https://mc.yandex.${zone}`).concat("https://mc.webvisor.com", "https://mc.webvisor.org");
const analytics = collectors.join(" ");
const sockets = collectors.map(origin => origin.replace("https:", "wss:")).join(" ");
const directives = [
  ["default-src", "'self'"],
  ["style-src", "'self' 'unsafe-inline'"],
  // VersaTiles serves the vector basemap tiles and glyphs (fetched, so connect-src);
  // OSM raster tiles are the fallback when WebGL is unavailable.
  ["img-src", `'self' data: blob: https://tile.openstreetmap.org https://img.pastvu.com ${analytics}`],
  ["frame-src", `'self' blob: ${analytics}`],
  ["child-src", `'self' blob: ${analytics}`],
  ["font-src", "'self'"],
  ["connect-src", `'self' https://tiles.versatiles.org ${analytics} ${sockets}`],
  // The audio unlock plays a generated silent WAV data: URI from the user's tap.
  ["media-src", "'self' data:"],
  // MapLibre bundles its tile worker and starts it from a blob: URL.
  ["worker-src", "'self' blob:"],
  ["manifest-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
];

const inlineScripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const existingPolicy = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi;

export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(inlineScripts)) {
    if (/\ssrc\s*=/i.test(` ${attributes}`) || !body) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...hashes].sort();
}

export function contentSecurityPolicy(scriptHashes) {
  const script = ["'self'", analytics, "https://yastatic.net", ...scriptHashes].join(" ");
  const [defaults, ...rest] = directives;
  return [defaults, ["script-src", script], ...rest]
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
}

/** Return the page with a policy meta tag that precedes every script. */
export function withContentSecurityPolicy(html) {
  const page = html.replace(existingPolicy, "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(inlineScriptHashes(page))}"/>`;
  const anchor = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i.exec(page) ?? /<head\b[^>]*>/i.exec(page);
  if (!anchor) throw new Error("Cannot place Content-Security-Policy: <head> is missing");
  const at = anchor.index + anchor[0].length;
  const result = page.slice(0, at) + meta + page.slice(at);
  const firstScript = result.search(/<script\b/i);
  if (firstScript !== -1 && firstScript < result.indexOf(meta)) {
    throw new Error("Cannot place Content-Security-Policy before the first script");
  }
  return result;
}
