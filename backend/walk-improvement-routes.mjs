import { failure } from "./domain.mjs";
import { UUID, WALK_NOT_FOUND, feedbackLimitKey, feedbackViewer, rejectUntrustedWrite, strictQuery, walkTargets } from "./walk-feedback.mjs";

const sharedPath = new RegExp(`^/api/story-walks/shared/(${UUID})/improvements/mine$`);
const catalogPath = /^\/api\/story-walks\/([a-z0-9][a-z0-9-]{0,127})\/improvements\/mine$/;
const ownPath = new RegExp(`^/api/me/walks/(${UUID})/improvements/mine$`);
const UNAVAILABLE = { error: { code: "UNAVAILABLE", message: "Запросы на улучшение временно недоступны." } };

/**
 * Improvement requests for catalog, shared and own account walks, plus the editor overview.
 * Same identity, origin and rate rules as reviews; the walk target is always resolved on the server.
 * @param {{ store: any, accountStore: any, origin: string, authSecret: string, limiter: ReturnType<typeof import("./walk-reviews.mjs").createReviewRateLimiter>,
 *   json: (res: import("node:http").ServerResponse, status: number, value: unknown) => void,
 *   body: (req: import("node:http").IncomingMessage, maxBytes?: number) => Promise<Record<string, unknown>> }} options
 */
export function createWalkImprovementRoutes({ store, accountStore, origin, authSecret, limiter, json, body }) {
  const targets = walkTargets({ store, accountStore });

  /** `trusted` routes already passed the /api/me Origin and CSRF checks. */
  async function handle(req, res, url, session, { resolve, trusted }) {
    if (!accountStore) { json(res, 503, UNAVAILABLE); return; }
    if (!["GET", "PUT"].includes(req.method)) {
      res.setHeader("Allow", "GET, PUT");
      json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }); return;
    }
    if (url.search) throw failure("BAD_REQUEST");
    const write = req.method === "PUT";
    if (write && !trusted && rejectUntrustedWrite(req, res, session, { origin, authSecret, json })) return;
    const target = resolve();
    if (!target) { json(res, 404, WALK_NOT_FOUND); return; }
    const viewer = feedbackViewer(req, session);
    if (!write) { json(res, 200, accountStore.getWalkImprovement(target, viewer)); return; }
    if (!viewer) { json(res, 400, { error: { code: "REVIEW_KEY_REQUIRED", message: "Не удалось определить автора запроса. Обновите страницу." } }); return; }
    const limitKey = feedbackLimitKey(req, session);
    const verdict = limiter.check(limitKey);
    if (!verdict.allowed) {
      res.setHeader("Retry-After", String(verdict.retryAfterSec));
      json(res, 429, { error: { code: "RATE_LIMITED", message: "Слишком много запросов на улучшение. Попробуйте позже." } }); return;
    }
    const input = await body(req, 1024);
    if (Object.keys(input).length !== 1 || !("issues" in input)) throw failure("BAD_REQUEST");
    const result = accountStore.saveWalkImprovement(target, viewer, input.issues);
    limiter.record(limitKey);
    json(res, 200, result);
  }

  return {
    /** Catalog and shared-walk requests; returns false when the path is not an improvement route. */
    async public(req, res, url, session) {
      const shared = sharedPath.exec(url.pathname), catalog = shared ? null : catalogPath.exec(url.pathname);
      if (!shared && !catalog) return false;
      await handle(req, res, url, session, { resolve: shared ? () => targets.shared(shared[1]) : () => targets.catalog(catalog[1]), trusted: false });
      return true;
    },
    /** Own account walk requests, called inside the authenticated /api/me block. */
    async own(req, res, url, session) {
      const match = ownPath.exec(url.pathname);
      if (!match) return false;
      await handle(req, res, url, session, { resolve: () => targets.own(session.user.id, match[1]), trusted: true });
      return true;
    },
    /** Editor overview inside the authorized /api/story-admin block. */
    async admin(req, res, url, editorId) {
      const list = url.pathname === "/api/story-admin/improvements", resolve = url.pathname === "/api/story-admin/improvements/resolve";
      if (!list && !resolve) return false;
      if (!accountStore) { json(res, 503, UNAVAILABLE); return true; }
      if (list && req.method === "GET") {
        const query = strictQuery(url, ["status", "issue", "q", "limit", "offset"], ["limit", "offset"]);
        const page = accountStore.listWalkImprovementsAdmin({
          status: query.status ?? "open", issue: query.issue ?? null, q: query.q ?? "",
          limit: Number(query.limit ?? 25), offset: Number(query.offset ?? 0),
        });
        json(res, 200, { ...page, walks: page.walks.map(item => ({ ...item, walk: { kind: item.walk.kind, id: item.walk.id, title: item.walk.title, url: targets.url(item.walk) } })) });
        return true;
      }
      if (resolve && req.method === "POST") {
        if (url.search) throw failure("BAD_REQUEST");
        const input = await body(req);
        if (Object.keys(input).some(key => !["kind", "id"].includes(key))) throw failure("BAD_REQUEST");
        json(res, 200, { resolved: accountStore.resolveWalkImprovements(input.kind, input.id, editorId) }); return true;
      }
      res.setHeader("Allow", list ? "GET" : "POST");
      json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }); return true;
    },
  };
}
