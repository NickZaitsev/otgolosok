import { notFound } from "next/navigation";
import { Trends } from "@/features/walks/trends";
import { isLocale } from "@/lib/i18n/locale";
import { siteMetadata } from "@/lib/i18n/root-document";

export default async function TrendsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <Trends />;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return siteMetadata(isLocale(locale) ? locale : "ru", "/trends");
}
