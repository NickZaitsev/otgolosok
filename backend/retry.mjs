// Bounded retries for outbound calls. Only transient failures (network errors,
// 408/425/429 and server errors) are retried; other client errors are
// deterministic and fail immediately.

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

export function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599 && status !== 501 && status !== 505);
}

/** Network failures and transient HTTP statuses. Deadlines and aborts are final. */
export function isTransientError(error) {
  if (!error || ["AbortError", "TimeoutError"].includes(error.name)) return false;
  if (Number.isInteger(error.status)) return isTransientStatus(error.status);
  const code = error.code ?? error.cause?.code;
  if (typeof code === "string" && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_"))) return true;
  // fetch() reports connection failures as a TypeError("fetch failed").
  return error.name === "TypeError" && error.message === "fetch failed";
}

/** Retry-After as delta seconds or an HTTP date, in milliseconds; null when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Calls `fn(attempt)` until it succeeds, a failure is not transient, or
 * `attempts` calls were made. Waits use full-jitter exponential backoff, or the
 * server's Retry-After (`error.retryAfter`) capped at `maxMs`.
 */
export async function withRetry(fn, { attempts = 4, baseMs = 500, maxMs = 8000, signal, isTransient = isTransientError, random = Math.random, wait = sleep } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError("attempts must be a positive integer");
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts - 1 || signal?.aborted || !isTransient(error)) throw error;
      const hinted = retryAfterMs(error?.retryAfter);
      const delay = hinted === null ? random() * Math.min(maxMs, baseMs * 2 ** attempt) : Math.min(maxMs, hinted);
      await wait(delay, signal);
    }
  }
}

/**
 * fetch() with `withRetry`. A transient response is retried while attempts
 * remain; the last response is returned as is so callers keep their own
 * handling of non-2xx statuses.
 */
export function fetchWithRetry(fetchImpl, url, init = {}, options = {}) {
  const attempts = options.attempts ?? 4;
  return withRetry(async attempt => {
    const response = await fetchImpl(url, init);
    if (attempt < attempts - 1 && isTransientStatus(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, retryAfter: response.headers.get("retry-after") });
    }
    return response;
  }, { signal: init.signal, ...options, attempts });
}
