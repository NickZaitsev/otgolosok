"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localizedPath, localeTag, type Locale, type TranslationValues } from "./locale";
import { translate } from "./translate";
const LocaleContext = createContext<Locale>("ru");
export function I18nProvider({ locale, children }: { locale: Locale; children?: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({
    locale, languageTag: localeTag[locale],
    t: (source: string, values?: TranslationValues) => translate(locale, source, values),
    path: (href: string) => localizedPath(href, locale),
  }), [locale]);
}
