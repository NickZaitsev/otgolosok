import { validateWalkView, walkRequestedLocale, type ContentLocale, type WalkDocument, type WalkView } from "./model";
import { loadOfflineWalk, type OfflineWalkRef } from "./offline";

export type WalkCard = {
  id: string;
  title: string;
  subtitle?: string;
  revision?: number;
  updatedAt?: string;
  visibility?: "private" | "shared" | "public";
  shareToken?: string | null;
  /** Top-listing state of a public walk; null for other access levels. */
  listingStatus?: "pending" | "approved" | "hidden" | null;
  travelMode?: "walking" | "driving";
  totalMinutes?: number | null;
  kind: "local" | "account" | "catalog";
};

const SHARE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class WalkLoadError extends Error {
  /** movedToShare: share token of the walk a catalogue walk moved to (HTTP 410 WALK_MOVED), otherwise null. */
  constructor(message: string, public readonly status = 0, public readonly retryable = false, public readonly retryAfterMs = 0, public readonly movedToShare: string | null = null) {
    super(message);
    this.name = "WalkLoadError";
  }
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function withTimeout(signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException("Request timed out", "TimeoutError")); }, timeoutMs);
  return { signal: controller.signal, wasTimedOut: () => timedOut, dispose: () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); } };
}

async function readJson(response: Response) {
  const value = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const record = value && typeof value === "object" ? value as { error?: { message?: string; code?: string; share?: unknown } } : {};
    const moved = record.error?.code === "WALK_MOVED" && typeof record.error.share === "string" && SHARE_TOKEN.test(record.error.share) ? record.error.share : null;
    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1_000 : 0;
    // A limit that lifts later than the retry budget allows is reported at once instead of retried in vain.
    const retryable = retryableStatus(response.status) && !(response.status === 429 && retryAfterMs > 5_000);
    throw new WalkLoadError(record.error?.message ?? "Не удалось открыть прогулку.", response.status, retryable, Math.min(5_000, retryAfterMs), moved);
  }
  return value;
}

export type LoadJsonInit = { method?: "PUT" | "DELETE"; headers?: Record<string, string> };

/**
 * payload, если задан, отправляется в JSON (по умолчанию POST); init задаёт метод PUT/DELETE и заголовки.
 * Запрос повторяется, поэтому должен быть идемпотентным.
 */
export async function loadJson<T>(url: string, signal: AbortSignal, validate: (value: unknown) => T, attempts = 3, payload?: unknown, init: LoadJsonInit = {}): Promise<T> {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError("Количество попыток должно быть от 1 до 3.");
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const timeout = withTimeout(signal, 20_000);
    try {
      const response = await fetch(url, payload === undefined
        ? { ...(init.method ? { method: init.method } : {}), ...(init.headers ? { headers: init.headers } : {}), signal: timeout.signal, credentials: "same-origin", cache: "no-store" }
        : { method: init.method ?? "POST", headers: { ...init.headers, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: timeout.signal, credentials: "same-origin", cache: "no-store" });
      const value = await readJson(response);
      try {
        return validate(value);
      } catch {
        throw new WalkLoadError("Сервис вернул повреждённую прогулку.", response.status, false);
      }
    } catch (error) {
      last = error;
      const timedOut = timeout.wasTimedOut() || error instanceof DOMException && error.name === "TimeoutError";
      const retry = error instanceof WalkLoadError ? error.retryable : timedOut || !(error instanceof DOMException && error.name === "AbortError");
      if (!retry || attempt + 1 >= attempts || signal.aborted) throw error;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
        const done = () => { signal.removeEventListener("abort", onAbort); resolve(); };
        const timer = setTimeout(done, Math.min(5_000, (error instanceof WalkLoadError ? error.retryAfterMs : 0) || 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    } finally {
      timeout.dispose();
    }
  }
  throw last ?? new WalkLoadError("Не удалось открыть прогулку.");
}

function localizedApiUrl(url: string, locale: ContentLocale) {
  return locale === "ru" ? url : `${url}${url.includes("?") ? "&" : "?"}lang=${locale}`;
}

function requestedView(value: unknown, locale: ContentLocale): WalkView {
  const view: WalkView = validateWalkView(value);
  if (walkRequestedLocale(view) !== locale) throw new Error("Сервис вернул прогулку на другом языке.");
  return view;
}

export function localWalkView(document: WalkDocument, revision: number, locale: ContentLocale = "ru"): WalkView {
  return validateWalkView({
    document,
    revision,
    contentVersion: locale === "ru" ? `local:${revision}` : `local:${locale}:${revision}`,
    ...(locale === "ru" ? {} : { requestedLocale: locale,
      documentLocalization: { requestedLocale: locale, contentLocale: "ru", fallbackReason: "missing" as const } }),
    chapters: document.stops.map(stop => ({
      id: stop.id,
      status: stop.storyRef ? "preparing" : "not_requested",
      story: null,
      audio: null,
      ...(locale === "ru" ? {} : { localization: { requestedLocale: locale, contentLocale: locale, fallbackReason: null } }),
    })),
  });
}

// Гостевая прогулка хранится только в браузере, поэтому опубликованные истории
// её остановок сервер подставляет по присланному документу.
export async function resolveLocalWalkView(document: WalkDocument, revision: number, signal: AbortSignal, locale: ContentLocale = "ru") {
  const base = localWalkView(document, revision, locale);
  if (!document.stops.some(stop => stop.storyRef)) return base;
  const resolved = await loadJson(localizedApiUrl("/api/story-walks/resolve", locale), signal, (value): WalkView => {
    const view = requestedView(value, locale);
    if (view.revision !== revision || view.chapters.some((chapter, index) => chapter.id !== base.chapters[index].id)
        || view.sourceDocument && JSON.stringify(view.sourceDocument) !== JSON.stringify(document)) throw new Error();
    return view;
  }, 3, { document, revision });
  return validateWalkView({ ...base, document: resolved.document, ...(resolved.sourceDocument ? { sourceDocument: resolved.sourceDocument } : {}),
    ...(resolved.documentLocalization !== undefined ? { documentLocalization: resolved.documentLocalization } : {}),
    contentVersion: locale === "ru" ? `local:${revision}:${resolved.contentVersion}` : `local:${locale}:${revision}:${resolved.contentVersion}`, chapters: resolved.chapters });
}

// Без сети прогулка всё равно открывается: остановки остаются в статусе «готовится».
export async function loadLocalWalkView(document: WalkDocument, revision: number, signal: AbortSignal, locale: ContentLocale = "ru") {
  try {
    return await resolveLocalWalkView(document, revision, signal, locale);
  } catch (error) {
    if (signal.aborted) throw error;
    return localWalkView(document, revision, locale);
  }
}

export function loadCatalogWalk(id: string, signal: AbortSignal, locale: ContentLocale = "ru") {
  return loadJson(localizedApiUrl(`/api/story-walks/${encodeURIComponent(id)}/view`, locale), signal, value => requestedView(value, locale));
}

export function loadSharedWalk(token: string, signal: AbortSignal, locale: ContentLocale = "ru") {
  return loadJson(localizedApiUrl(`/api/story-walks/shared/${encodeURIComponent(token)}`, locale), signal, value => requestedView(value, locale));
}

export function loadAccountWalk(id: string, signal: AbortSignal, locale: ContentLocale = "ru") {
  return loadJson(localizedApiUrl(`/api/me/walks/${encodeURIComponent(id)}/view`, locale), signal, value => requestedView(value, locale));
}

export type LoadedWalk = { view: WalkView; offline: false } | { view: WalkView; offline: true; savedAt: string };

/**
 * Загружает прогулку из сети, а при сбое сети или сервера открывает сохранённую
 * офлайн-копию. Ответы «не найдена» и «нет доступа» копией не подменяются.
 */
export async function loadWalkWithOfflineCopy(load: (signal: AbortSignal) => Promise<WalkView>, ref: OfflineWalkRef | null, signal: AbortSignal,
  usable: (saved: WalkView) => boolean = () => true): Promise<LoadedWalk> {
  try {
    return { view: await load(signal), offline: false };
  } catch (error) {
    if (signal.aborted || !ref || error instanceof WalkLoadError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
    const saved = await loadOfflineWalk(ref, undefined, { seedFood: true }).catch(() => null);
    if (saved && usable(saved.view)) return { view: saved.view, offline: true, savedAt: saved.manifest.savedAt };
    throw error;
  }
}
