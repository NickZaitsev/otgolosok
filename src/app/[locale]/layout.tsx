import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { RootDocument, siteMetadata } from "@/lib/i18n/root-document";
export { viewport } from "@/lib/i18n/root-document";
export const dynamicParams = false;
export function generateStaticParams() { return [{ locale: "en" }, { locale: "zh" }]; }
type Props = { children: ReactNode; params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Omit<Props, "children">) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return siteMetadata(locale);
}
export default async function LocalizedLayout({ children, params }: Props) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <RootDocument locale={locale}>{children}</RootDocument>;
}
