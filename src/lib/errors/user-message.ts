// Every message written for users — in the UI and in our API's JSON errors — is
// Russian, so a Cyrillic message is shown as is. Browser and runtime errors
// ("Failed to fetch", "signal timed out", JSON parse errors) are replaced with
// an explanation the user can act on.
const RUSSIAN = /[А-Яа-яЁё]/;
const NETWORK_FAILURE = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i;

export const USER_MESSAGES = {
  network: "Нет связи с сервером. Проверьте интернет и повторите попытку.",
  timeout: "Сервер долго не отвечает. Повторите попытку.",
  aborted: "Запрос прерван. Повторите попытку.",
  badResponse: "Сервер вернул неожиданный ответ. Повторите попытку позже.",
  storageFull: "На устройстве не хватает места. Освободите память и повторите попытку.",
} as const;

function errorName(error: unknown) {
  return error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : "";
}

/** Text to show for a caught error: our own Russian messages, otherwise a readable explanation or `fallback`. */
export function toUserMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error || error instanceof DOMException ? error.message : "";
  if (message && RUSSIAN.test(message)) return message;
  switch (errorName(error)) {
    case "TimeoutError": return USER_MESSAGES.timeout;
    case "AbortError": return USER_MESSAGES.aborted;
    case "QuotaExceededError": return USER_MESSAGES.storageFull;
    case "NetworkError": return USER_MESSAGES.network;
    case "SyntaxError": return USER_MESSAGES.badResponse;
    case "TypeError": return NETWORK_FAILURE.test(message) ? USER_MESSAGES.network : fallback;
    default: return fallback;
  }
}
