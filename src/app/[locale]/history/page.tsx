import { siteMetadata } from "@/lib/i18n/root-document";
import { isLocale } from "@/lib/i18n/locale";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WalkLibrary } from "@/features/walks/walk-library";
import { translate } from "@/lib/i18n/translate";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <Suspense fallback={<main className="ui-page"><p role="status">{translate(locale, "Открываем прогулки…")}</p></main>}><WalkLibrary /></Suspense>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return siteMetadata(isLocale(locale) ? locale : "ru", "/history");
}
