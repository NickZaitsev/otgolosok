import { type ReactNode, Suspense } from "react";
import { YandexMetrika } from "@/features/analytics/yandex-metrika";
import { I18nProvider } from "./provider";
import { htmlLanguage, localizedPath, type Locale } from "./locale";
import type { Metadata, Viewport } from "next";
import { AppNavigation } from "@/features/navigation/app-navigation";
import { NativeShell } from "@/features/native/native-shell";
import { CookieNotice } from "@/features/legal/cookie-notice";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/ui.css";
import "@/styles/legacy.css";

const baseMetadata: Metadata = {
  // iOS ignores SVG touch icons (scripts/build-app-icons.mjs).
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  title: "Отголосок — город говорит рядом",
  description:
    "Аудиопрогулки по Москве и Казани, которые начинаются там, где случилась история.",
  applicationName: "Отголосок",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Отголосок",
  },
  formatDetection: { telephone: false },
};

// The page draws under notches and the home indicator; safe-area tokens keep content clear of them.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export function RootDocument({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <html lang={htmlLanguage[locale]}>
      <body>
        <I18nProvider locale={locale}>{children}<AppNavigation /><NativeShell /><CookieNotice /></I18nProvider>
        <Suspense fallback={null}><YandexMetrika /></Suspense>
      </body>
    </html>
  );
}

const descriptions = {
  ru: "Аудиопрогулки по Москве и Казани, которые начинаются там, где случилась история.",
  en: "Audio walks around Moscow and Kazan, starting where each story happened.",
  zh: "漫步莫斯科和喀山，在故事发生的地方聆听城市往事。",
};
const titles = { ru: "Отголосок — город говорит рядом", en: "Otgolosok — the city's stories, right here", zh: "Otgolosok — 聆听身边的城市故事" };
export function siteMetadata(locale: Locale, pathname = "/"): Metadata {
  return { ...baseMetadata, title: titles[locale], description: descriptions[locale],
    robots: pathname === "/account" || pathname === "/login" ? { index: false, follow: false } : undefined,
    manifest: locale === "ru" ? "/manifest.webmanifest" : `/${locale}/manifest.webmanifest`,
    alternates: { canonical: localizedPath(pathname, locale), languages: { ru: localizedPath(pathname, "ru"), en: localizedPath(pathname, "en"), "zh-Hans": localizedPath(pathname, "zh"), "x-default": localizedPath(pathname, "ru") } },
  };
}
