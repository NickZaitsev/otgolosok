import { Suspense } from "react";
import { WalkLibrary } from "@/features/walks/walk-library";
import { siteMetadata } from "@/lib/i18n/root-document";

export default function MyWalksPage() {
  return <Suspense fallback={<main className="ui-page history-page"><p role="status">Открываем прогулки…</p></main>}><WalkLibrary mode="mine" /></Suspense>;
}

export const metadata = siteMetadata("ru", "/account/walks");
