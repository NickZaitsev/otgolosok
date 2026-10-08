import { siteMetadata } from "@/lib/i18n/root-document";
import { Trends } from "@/features/walks/trends";

export default function TrendsPage() {
  return <Trends />;
}

export const metadata = siteMetadata("ru", "/trends");
