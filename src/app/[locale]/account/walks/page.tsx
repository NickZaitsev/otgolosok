import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WalkLibrary } from "@/features/walks/walk-library";
import { isLocale } from "@/lib/i18n/locale";
import { siteMetadata } from "@/lib/i18n/root-document";
import { translate } from "@/lib/i18n/translate";

export default async function MyWalksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <Suspense fallback={<main className="ui-page history-page"><p role="status">{translate(locale, "Открываем прогулки…")}</p></main>}><WalkLibrary mode="mine" /></Suspense>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return siteMetadata(isLocale(locale) ? locale : "ru", "/account/walks");
}
