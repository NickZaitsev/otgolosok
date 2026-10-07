"use client";
import { useI18n } from "./provider";
import type { Locale } from "./locale";

/** Interface localization does not imply translated editorial content or recordings. */
export function ContentLanguageNote({ contentLocale = "ru", audioAvailable = true }: { contentLocale?: Locale; audioAvailable?: boolean }) {
  const { locale, t } = useI18n();
  if (locale === "ru") return null;
  let message: string;
  if (contentLocale === "ru") {
    message = audioAvailable
      ? "Текст и аудио этой истории пока доступны только на русском языке."
      : "Текст этой истории пока доступен только на русском языке. Озвучка готовится.";
  } else if (contentLocale === locale && !audioAvailable) {
    message = "Озвучка этой истории на выбранном языке ещё готовится.";
  } else return null;
  return <p className="source-note" role="note">{t(message)}</p>;
}
