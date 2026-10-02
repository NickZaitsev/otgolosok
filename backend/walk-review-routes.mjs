import { failure } from "./domain.mjs";
import { UUID, WALK_NOT_FOUND, feedbackLimitKey, feedbackViewer, rejectUntrustedWrite, strictQuery, walkTargets } from "./walk-feedback.mjs";

const sharedPath = new RegExp(`^/api/story-walks/shared/(${UUID})/reviews(/mine)?$`);
const catalogPath = /^\/api\/story-walks\/([a-z0-9][a-z0-9-]{0,127})\/reviews(\/mine)?$/;
const ownPath = new RegExp(`^/api/me/walks/(${UUID})/reviews(/mine)?$`);
const adminItemPath = new RegExp(`^/api/story-admin/reviews/(${UUID})/(moderate|delete)$`);

/**
 * Review endpoints for catalog, shared and own account walks, plus the editor moderation API.
 * The walk target is always resolved on the server; the client only names the walk.
 * @param {{ store: any, accountStore: any, origin: string, authSecret: string, limiter: ReturnType<typeof import("./walk-reviews.mjs").createReviewRateLimiter>,
 *   json: (res: import("node:http").ServerResponse, status: number, value: unknown) => void,
 *   body: (req: import("node:http").IncomingMessage, maxBytes?: number) => Promise<Record<string, unknown>> }} options
 */
export function createWalkReviewRoutes({ store, accountStore, origin, authSecret, limiter, json, body }) {
  const targets = walkTargets({ store, accountStore });

  /** Shared handler; `trusted` routes already passed the /api/me Origin and CSRF checks. */
  async function handle(req, res, url, session, { resolve, mine, trusted }) {
    if (!accountStore) { json(res, 503, { error: { code: "UNAVAILABLE", message: "Отзывы временно недоступны." } }); return; }
    const allowed = mine ? ["PUT", "DELETE"] : ["GET"];
    if (!allowed.includes(req.method)) {
      res.setHeader("Allow", allowed.join(", "));
      json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }); return;
    }
    const write = req.method !== "GET";
    if (write && !trusted && rejectUntrustedWrite(req, res, session, { origin, authSecret, json })) return;
    const target = resolve();
    if (!target) { json(res, 404, WALK_NOT_FOUND); return; }
    const viewer = feedbackViewer(req, session);
    if (!write) {
      const query = strictQuery(url, ["cursor"]);
      json(res, 200, accountStore.getWalkReviews(target, viewer, { after: query.cursor ?? null })); return;
    }
    if (url.search) throw failure("BAD_REQUEST");
    if (!viewer) { json(res, 400, { error: { code: "REVIEW_KEY_REQUIRED", message: "Не удалось определить автора отзыва. Обновите страницу." } }); return; }
    const limitKey = feedbackLimitKey(req, session);
    const verdict = limiter.check(limitKey);
    if (!verdict.allowed) {
      res.setHeader("Retry-After", String(verdict.retryAfterSec));
      json(res, 429, { error: { code: "RATE_LIMITED", message: "Слишком много изменений отзывов. Попробуйте позже." } }); return;
    }
    let result;
    if (req.method === "PUT") {
      const input = await body(req, 8192);
      if (!("rating" in input) || Object.keys(input).some(key => !["rating", "text"].includes(key))) throw failure("BAD_REQUEST");
      result = accountStore.saveWalkReview(target, viewer, { rating: input.rating, text: input.text });
    } else {
      result = accountStore.deleteWalkReview(target, viewer);
    }
    limiter.record(limitKey);
    json(res, 200, result);
  }

  const adminView = review => ({ ...review, walk: { kind: review.walk.kind, id: review.walk.id, title: review.walk.title, url: targets.url(review.walk) } });

  return {
    /** Public catalog and shared-walk reviews; returns false when the path is not a review route. */
    async public(req, res, url, session) {
      const shared = sharedPath.exec(url.pathname), catalog = shared ? null : catalogPath.exec(url.pathname);
      if (!shared && !catalog) return false;
      const resolve = shared ? () => targets.shared(shared[1]) : () => targets.catalog(catalog[1]);
      await handle(req, res, url, session, { resolve, mine: Boolean((shared ?? catalog)[2]), trusted: false });
      return true;
    },
    /** Own account walk reviews, called inside the authenticated /api/me block. */
    async own(req, res, url, session) {
      const match = ownPath.exec(url.pathname);
      if (!match) return false;
      await handle(req, res, url, session, { resolve: () => targets.own(session.user.id, match[1]), mine: Boolean(match[2]), trusted: true });
      return true;
    },
    /** Editor moderation API inside the authorized /api/story-admin block. */
    async admin(req, res, url, editorId) {
      const list = url.pathname === "/api/story-admin/reviews", item = adminItemPath.exec(url.pathname);
      if (!list && !item) return false;
      if (!accountStore) { json(res, 503, { error: { code: "UNAVAILABLE", message: "Хранилище отзывов недоступно." } }); return true; }
      if (list && req.method === "GET") {
        const query = strictQuery(url, ["status", "rating", "q", "limit", "offset"], ["rating", "limit", "offset"]);
        const page = accountStore.listWalkReviewsAdmin({
          status: query.status ?? "pending", rating: query.rating === undefined ? null : Number(query.rating), q: query.q ?? "",
          limit: Number(query.limit ?? 25), offset: Number(query.offset ?? 0),
        });
        json(res, 200, { ...page, reviews: page.reviews.map(adminView) }); return true;
      }
      if (item && req.method === "POST") {
        if (url.search) throw failure("BAD_REQUEST");
        const input = await body(req);
        if (item[2] === "moderate") {
          if (Object.keys(input).some(key => key !== "action")) throw failure("BAD_REQUEST");
          const review = accountStore.moderateWalkReview(item[1], input.action, editorId);
          json(res, review ? 200 : 404, review ? { review: adminView(review) } : { error: { code: "NOT_FOUND", message: "Отзыв не найден." } }); return true;
        }
        if (Object.keys(input).length) throw failure("BAD_REQUEST");
        const deleted = accountStore.deleteWalkReviewAdmin(item[1]);
        json(res, deleted ? 200 : 404, deleted ? { success: true } : { error: { code: "NOT_FOUND", message: "Отзыв не найден." } }); return true;
      }
      res.setHeader("Allow", list ? "GET" : "POST");
      json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }); return true;
    },
  };
}
