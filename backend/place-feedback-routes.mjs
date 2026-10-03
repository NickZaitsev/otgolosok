import { failure } from "./domain.mjs";
import { feedbackLimitKey, feedbackViewer, rejectUntrustedWrite, strictQuery } from "./walk-feedback.mjs";

export function createPlaceFeedbackRoutes({ store, accountStore, origin, authSecret, limiter, json, body }) {
  const unavailable = res => json(res, 503, { error: { code: "UNAVAILABLE", message: "Оценки мест временно недоступны." } });
  return {
    async public(req, res, url, session) {
      const match = /^\/api\/content\/places\/(osm:(?:node|way|relation):\d+)\/feedback\/mine$/.exec(url.pathname);
      if (!match) return false;
      if (!accountStore) { unavailable(res); return true; }
      if (!["GET", "PUT"].includes(req.method)) {
        res.setHeader("Allow", "GET, PUT"); json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Метод не поддерживается." } }); return true;
      }
      if (url.search) throw failure("BAD_REQUEST");
      const write = req.method === "PUT";
      if (write && rejectUntrustedWrite(req, res, session, { origin, authSecret, json })) return true;
      const place = store.getPublishedPlace(match[1]);
      if (!place) { json(res, 404, { error: { code: "NOT_FOUND", message: "Место не найдено." } }); return true; }
      const viewer = feedbackViewer(req, session);
      if (!write) { json(res, 200, accountStore.getPlaceFeedback(place.id, viewer)); return true; }
      if (!viewer) { json(res, 400, { error: { code: "REVIEW_KEY_REQUIRED", message: "Не удалось сохранить оценку. Обновите страницу." } }); return true; }
      const key = feedbackLimitKey(req, session), verdict = limiter.check(key);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSec));
        json(res, 429, { error: { code: "RATE_LIMITED", message: "Слишком много оценок. Попробуйте позже." } }); return true;
      }
      const input = await body(req, 8192);
      const result = accountStore.savePlaceFeedback(place, viewer, input);
      limiter.record(key); json(res, 200, result); return true;
    },
    async admin(req, res, url) {
      const list = url.pathname === "/api/story-admin/place-feedback", resolve = url.pathname === "/api/story-admin/place-feedback/resolve";
      if (!list && !resolve) return false;
      if (!accountStore) { unavailable(res); return true; }
      if (list && req.method === "GET") {
        const query = strictQuery(url, ["limit", "offset"], ["limit", "offset"]);
        json(res, 200, accountStore.listPlaceFeedbackAdmin({ limit: Number(query.limit ?? 25), offset: Number(query.offset ?? 0) })); return true;
      }
      if (resolve && req.method === "POST") {
        if (url.search) throw failure("BAD_REQUEST");
        const input = await body(req, 1024);
        if (Object.keys(input).length !== 1 || !("id" in input)) throw failure("BAD_REQUEST");
        json(res, 200, accountStore.resolvePlaceFeedback(input.id)); return true;
      }
      res.setHeader("Allow", list ? "GET" : "POST");
      json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Метод не поддерживается." } }); return true;
    },
  };
}
