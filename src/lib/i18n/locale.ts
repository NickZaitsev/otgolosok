export const LOCALES = ["ru", "en", "zh"] as const;
export type Locale = typeof LOCALES[number];
export const localeTag: Record<Locale, string> = { ru: "ru-RU", en: "en", zh: "zh-CN" };
export const htmlLanguage: Record<Locale, string> = { ru: "ru", en: "en", zh: "zh-Hans" };
export const languageNames: Record<Locale, string> = { ru: "Русский", en: "English", zh: "简体中文" };
export type Translations = Record<string, readonly [en: string, zh: string]>;
export type TranslationValues = Record<string, string | number>;
export function isLocale(value: string): value is Locale { return LOCALES.some(locale => locale === value); }
export function localeFromPath(pathname: string): Locale {
  const segment = pathname.split("/")[1];
  return segment === "en" || segment === "zh" ? segment : "ru";
}
export function unlocalizedPath(pathname: string): string {
  return pathname.replace(/^\/(en|zh)(?=\/|$)/, "") || "/";
}
const PUBLIC_PAGES = new Set(["/", "/walk", "/history", "/account", "/login"]);
/** Localize app pages only; API paths, assets, admin and external URLs stay intact. */
export function localizedPath(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const match = /^([^?#]*)([?#].*)?$/.exec(href);
  if (!match) return href;
  const pathname = unlocalizedPath(match[1]).replace(/\/+$/, "") || "/";
  if (!PUBLIC_PAGES.has(pathname)) return href;
  const prefix = locale === "ru" ? "" : `/${locale}`;
  return `${prefix}${pathname === "/" ? (prefix ? "" : "/") : pathname}${match[2] ?? ""}`;
}
