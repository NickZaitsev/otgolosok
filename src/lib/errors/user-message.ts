import type { Locale } from "@/lib/i18n/locale";
import { translate, translations } from "@/lib/i18n/translate";
// Russian remains the server contract. Foreign interfaces translate known errors
// and use a safe localized fallback for unknown runtime messages.
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

/** Never expose raw runtime details or an unknown server language in a foreign interface. */
export function toUserMessage(error: unknown, fallback: string, locale: Locale = "ru"): string {
  const message = error instanceof Error || error instanceof DOMException ? error.message : "";
  if (locale !== "ru") {
    if (message && Object.hasOwn(translations, message)) return translate(locale, message);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const known = Object.hasOwn(ERROR_CODE_MESSAGES, code) ? ERROR_CODE_MESSAGES[code] : undefined;
    if (known) return translate(locale, known);
  }
  if (message && RUSSIAN.test(message)) return locale === "ru" ? message : translate(locale, fallback);
  switch (errorName(error)) {
    case "TimeoutError": return translate(locale, USER_MESSAGES.timeout);
    case "AbortError": return translate(locale, USER_MESSAGES.aborted);
    case "QuotaExceededError": return translate(locale, USER_MESSAGES.storageFull);
    case "NetworkError": return translate(locale, USER_MESSAGES.network);
    case "SyntaxError": return translate(locale, USER_MESSAGES.badResponse);
    case "TypeError": return translate(locale, NETWORK_FAILURE.test(message) ? USER_MESSAGES.network : fallback);
    default: return translate(locale, fallback);
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Войдите в аккаунт.", AUTH_REQUIRED: "Войдите в аккаунт.",
  CSRF: "Обновите страницу и повторите действие.", PASSWORD_INVALID: "Неверный пароль.",
  SERVICE_UNAVAILABLE: "Нет связи с сервером. Проверьте интернет и повторите попытку.",
};
