"use client";
import { isWalkInProgress } from "@/features/tour/walk-activity";
import { mediaPlaying } from "@/lib/offline/auto-update";
import { LOCALES, languageNames, localizedPath, isLocale } from "./locale";
import { useI18n } from "./provider";
import styles from "./language-switcher.module.css";
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  return <select className={styles.select} data-compact={compact || undefined} aria-label={t("Язык интерфейса")} value={locale} onChange={event => {
    const next = event.currentTarget.value;
    if (!isLocale(next) || next === locale) return;
    if ((isWalkInProgress() || mediaPlaying(document)) && !window.confirm(t("Смена языка прервёт прогулку. Продолжить?"))) {
      event.currentTarget.value = locale;
      return;
    }
    // A full navigation keeps the exported HTML, metadata and provider locale in sync.
    window.location.assign(localizedPath(`${location.pathname}${location.search}${location.hash}`, next));
  }}>
    {LOCALES.map(language => <option key={language} value={language} lang={language === "zh" ? "zh-Hans" : language}>{compact ? { ru: "RU", en: "EN", zh: "中文" }[language] : languageNames[language]}</option>)}
  </select>;
}
