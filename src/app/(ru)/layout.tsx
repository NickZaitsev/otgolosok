import type { ReactNode } from "react";
import { RootDocument, siteMetadata } from "@/lib/i18n/root-document";
export { viewport } from "@/lib/i18n/root-document";
export const metadata = siteMetadata("ru");
export default function RussianLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="ru">{children}</RootDocument>;
}
