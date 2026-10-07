import { localizedPath, type Locale } from "@/lib/i18n/locale";

export function safeReturnTo(value: string | null, origin: string, locale: Locale = "ru"): string {
  const fallback = localizedPath("/account", locale);
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const base = new URL(origin);
    if (!/^https?:$/.test(base.protocol)) return fallback;
    const target = new URL(value, base);
    if (target.origin !== base.origin || !/^https?:$/.test(target.protocol)) return fallback;
    return localizedPath(`${target.pathname}${target.search}${target.hash}`, locale);
  } catch {
    return fallback;
  }
}
