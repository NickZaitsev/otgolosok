"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { LEGAL_READY } from "../../../legal/publication.mjs";
import { cookieChoice, subscribeCookieChoice, COOKIE_SETTINGS_EVENT } from "./cookie-consent";
import { recordCookieChoice } from "./record-choice";
import styles from "./legal.module.css";
import overlayStyles from "../shell/global-overlay.module.css";

const subscribeClientReady = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;

export function CookieNotice() {
  const { t } = useI18n();
  const clientReady = useSyncExternalStore(subscribeClientReady, clientReadySnapshot, serverReadySnapshot);
  const choice = useSyncExternalStore(subscribeCookieChoice, cookieChoice, () => null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const open = () => setOpened(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, open);
  }, []);
  if (!clientReady || (choice !== null && !opened)) return null;
  async function choose(analytics: boolean) {
    if (busy || (analytics && !LEGAL_READY)) return;
    setBusy(true); setError(""); setOpened(true);
    try { await recordCookieChoice(analytics); setOpened(false); }
    catch { setError(t(analytics ? "Не удалось сохранить выбор. Аналитика остаётся выключенной." : "Аналитика выключена на этом устройстве. Не удалось подтвердить отзыв на сервере. Повторите выбор.")); }
    finally { setBusy(false); }
  }
  return <div className={overlayStyles.notice}><aside className={styles.notice} aria-labelledby="cookie-notice-title">
    <h2 id="cookie-notice-title">{t("Cookie и приватность")}</h2>
    <p>{t("Необходимые cookie поддерживают вход. Настройки и прогулки сохраняются на устройстве. Аналитика Яндекс.Метрики включается только с вашего согласия.")}</p>
    <div className={styles.links}>
      <Link href="/legal/cookies">{t("О cookie")}</Link>
      <Link href="/legal/privacy">{t("Политика обработки данных")}</Link>
      <Link href="/legal/analytics-consent">{t("Согласие на аналитику")}</Link>
    </div>
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void choose(false)}>{t("Только необходимые")}</button>
      {LEGAL_READY && <button type="button" disabled={busy} onClick={() => void choose(true)}>{t("Разрешить аналитику")}</button>}
      {opened && choice !== null && <button type="button" disabled={busy} onClick={() => setOpened(false)}>{t("Закрыть")}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </aside></div>;
}
