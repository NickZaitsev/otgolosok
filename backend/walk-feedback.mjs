import { validSessionCsrf } from "./auth.mjs";
import { failure } from "./domain.mjs";
import { guestKeyHash } from "./walk-reviews.mjs";

export const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const WALK_NOT_FOUND = { error: { code: "NOT_FOUND", message: "Прогулка не найдена." } };

/** Query strings are strict: unknown or repeated keys are a client bug, not something to ignore. */
export function strictQuery(url, allowed, numeric = []) {
  const entries = [...url.searchParams];
  if (entries.some(([key, value]) => !allowed.includes(key) || (numeric.includes(key) && !/^\d+$/.test(value)))
    || new Set(entries.map(([key]) => key)).size !== entries.length) throw failure("BAD_REQUEST");
  return Object.fromEntries(entries);
}

/**
 * Viewer feedback (reviews, improvement requests) names a walk; the server resolves it.
 * Only published catalog walks and readable account snapshots can collect feedback.
 */
export function walkTargets({ store, accountStore }) {
  const catalog = slug => {
    const route = store.getPublishedWalk(slug);
    return route?.walk?.steps?.length ? { kind: "catalog", id: slug, title: String(route.title ?? slug), revision: 0 } : null;
  };
  const account = walk => walk && !walk.snapshotError ? { kind: "account", id: walk.id, title: walk.title, revision: walk.revision } : null;
  return {
    catalog,
    shared: token => account(accountStore.getSharedWalk(token)),
    own: (userId, id) => account(accountStore.getWalk(userId, id)),
    /** Editor links: null once a walk is unpublished or its link is revoked. */
    url: walk => walk.kind === "catalog"
      ? (catalog(walk.id) ? `/walk?catalog=${encodeURIComponent(walk.id)}` : null)
      : (walk.shareToken ? `/walk?share=${walk.shareToken}` : null),
  };
}

/**
 * Same-origin and CSRF gate for public feedback writes. The generic same-origin gate covers POST
 * only, so PUT and DELETE are checked here; /api/me routes have passed it already.
 * @returns {boolean} true when the response has been sent
 */
export function rejectUntrustedWrite(req, res, session, { origin, authSecret, json }) {
  if (!origin || req.headers.origin !== origin || ![undefined, "same-origin", "none"].includes(req.headers["sec-fetch-site"])) {
    json(res, 403, { error: { code: "FORBIDDEN", message: "Same-origin request required." } }); return true;
  }
  if (session && !validSessionCsrf(authSecret, session.session.id, req.headers["x-csrf-token"])) {
    json(res, 403, { error: { code: "CSRF", message: "Обновите страницу и повторите действие." } }); return true;
  }
  return false;
}

/** The signed-in account, or the guest's device key (stored only as a digest); null for an anonymous read. */
export function feedbackViewer(req, session) {
  const rawKey = req.headers["x-review-key"];
  return session ? { userId: session.user.id } : rawKey !== undefined ? { guestKeyHash: guestKeyHash(rawKey) } : null;
}

/** Rate-limit key: the account, or the client IP (X-Real-IP is overwritten by nginx, as for the walk planner). */
export function feedbackLimitKey(req, session) {
  return session ? `user:${session.user.id}` : `ip:${String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")}`;
}
