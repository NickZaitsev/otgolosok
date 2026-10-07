import { siteMetadata } from "@/lib/i18n/root-document";
import { isLocale } from "@/lib/i18n/locale";
export { default } from "../../(ru)/login/page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return siteMetadata(isLocale(locale) ? locale : "ru", "/login");
}
