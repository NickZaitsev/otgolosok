"use client";
import { useI18n } from "./provider";
/** Interface localization does not imply translated editorial content or recordings. */
export function ContentLanguageNote() {
  const { locale, t } = useI18n();
  return locale === "ru" ? null : <p className="source-note" role="note">{t("Текст и аудио этой истории пока доступны только на русском языке.")}</p>;
}
