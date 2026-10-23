"use client";
import { useEffect, useRef, useState } from "react";
import { startTelegramAuthorization } from "./client";
import { useI18n } from "@/lib/i18n/provider";
import { appAuthCallbacks, appAuthError, appAuthRedirect, appAuthTermsAccepted, isHandoffChallenge, isHandoffCode, type AppAuthError } from "./app-auth";
import "./auth.css";

// Pages opened by the mobile app in a Custom Tab; they only hand the result back to the app.
const failureTexts: Record<AppAuthError, string> = {
  TERMS_REQUIRED: "Для регистрации примите актуальные условия использования в приложении.",
  CANCELLED: "Вход отменён.",
  FAILED: "Не удалось войти через Telegram. Вернитесь в приложение и попробуйте ещё раз.",
};
const REQUEST_TIMEOUT_MS = 20_000;

type Leave = (result: { code: string } | { error: AppAuthError }) => void;

function AppAuthScreen({ initialStatus, run }: { initialStatus: string; run: (leave: Leave) => Promise<void> }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(initialStatus);
  const [returnURL, setReturnURL] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    // Strict Mode mounts twice in development; the flow must start once.
    if (started.current) return;
    started.current = true;
    const leave: Leave = result => {
      const target = appAuthRedirect(result);
      setStatus("code" in result ? "Возвращаемся в приложение…" : failureTexts[result.error]);
      setReturnURL(target);
      location.replace(target);
    };
    void run(leave).catch(() => leave({ error: "FAILED" }));
  }, [run]);
  return <main className="ui-page"><section className="auth-card">
    <h1>{t("Вход через Telegram")}</h1>
    <p role="status" aria-live="polite">{t(status)}</p>
    {/* Chrome may block an app link opened without a tap: the button repeats it. */}
    {returnURL && <a className="account-button" href={returnURL}>{t("Вернуться в приложение")}</a>}
  </section></main>;
}

async function start(leave: Leave) {
  const parameters = new URLSearchParams(location.search), challenge = parameters.get("challenge");
  if (!isHandoffChallenge(challenge)) { leave({ error: "FAILED" }); return; }
  const { callbackURL, errorCallbackURL } = appAuthCallbacks(challenge, location.origin);
  try {
    location.replace(await startTelegramAuthorization(callbackURL, errorCallbackURL, appAuthTermsAccepted(parameters.get("terms"))));
  } catch (error) {
    leave({ error: appAuthError((error as { code?: string } | null)?.code ?? null) });
  }
}

async function complete(leave: Leave) {
  const parameters = new URLSearchParams(location.search), challenge = parameters.get("challenge");
  if (!isHandoffChallenge(challenge)) { leave({ error: "FAILED" }); return; }
  if (parameters.get("failed") === "1") { leave({ error: appAuthError(parameters.get("error")) }); return; }
  const request = { credentials: "same-origin", cache: "no-store" } as const;
  const sessionResponse = await fetch("/api/auth/session", { ...request, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const session = sessionResponse.ok ? await sessionResponse.json() as { user?: unknown; csrfToken?: unknown } : null;
  if (!session?.user || typeof session.csrfToken !== "string") { leave({ error: "FAILED" }); return; }
  let result: { code: string } | { error: AppAuthError } = { error: "FAILED" };
  try {
    const response = await fetch("/api/mobile-auth/handoff", { ...request, method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken }, body: JSON.stringify({ challenge }) });
    const value = await response.json().catch(() => null) as { code?: unknown } | null;
    if (response.ok && isHandoffCode(value?.code)) result = { code: value.code };
  } finally {
    // The app gets its own session; the browser one is not needed. Best effort: it expires anyway.
    await fetch("/api/auth/sign-out", { ...request, method: "POST", signal: AbortSignal.timeout(5_000),
      headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  }
  leave(result);
}

// Status texts are translated where they are shown (dictionaries/account.ts).
const STARTING = "Открываем Telegram…", COMPLETING = "Завершаем вход…";
export const AppAuthStart = () => <AppAuthScreen initialStatus={STARTING} run={start} />;
export const AppAuthComplete = () => <AppAuthScreen initialStatus={COMPLETING} run={complete} />;
