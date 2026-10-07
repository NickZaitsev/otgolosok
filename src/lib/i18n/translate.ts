import { coreTranslations } from "./dictionaries/core";
import { exploreTranslations } from "./dictionaries/explore";
import { walksTranslations } from "./dictionaries/walks";
import { accountTranslations } from "./dictionaries/account";
import type { Locale, TranslationValues, Translations } from "./locale";
export function mergeTranslations(...dictionaries: Translations[]): Translations {
  const merged: Translations = {};
  for (const dictionary of dictionaries) for (const [source, pair] of Object.entries(dictionary)) {
    const previous = Object.hasOwn(merged, source) ? merged[source] : undefined;
    if (previous && (previous[0] !== pair[0] || previous[1] !== pair[1])) throw new Error(`Conflicting interface translation: ${source}`);
    Object.defineProperty(merged, source, { value: pair, enumerable: true, configurable: true });
  }
  return merged;
}
export const translations = mergeTranslations(coreTranslations, exploreTranslations, walksTranslations, accountTranslations);
/** Russian source strings are stable keys; placeholders keep sentence order local to each language. */
export function translate(locale: Locale, source: string, values: TranslationValues = {}): string {
  const entry = Object.hasOwn(translations, source) ? translations[source] : undefined;
  const text = locale === "ru" || !entry ? source : entry[locale === "en" ? 0 : 1];
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}
