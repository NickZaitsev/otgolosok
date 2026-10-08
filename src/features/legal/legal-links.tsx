"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { openCookieSettings } from "./cookie-consent";
import styles from "./legal.module.css";

export function LegalLinks() {
  const { t } = useI18n();
  return <nav className={styles.links} aria-label={t("Правовая информация")}>
    <Link href="/legal/terms">{t("Условия использования")}</Link>
    <Link href="/legal/privacy">{t("Политика обработки данных")}</Link>
    <button type="button" onClick={openCookieSettings}>{t("Настройки cookie")}</button>
  </nav>;
}
