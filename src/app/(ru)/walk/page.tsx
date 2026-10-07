import { siteMetadata } from "@/lib/i18n/root-document";
import { Suspense } from "react";
import { WalkScreen } from "@/features/walks/walk-screen";

export default function WalkPage() {
  return <Suspense fallback={<main className="walk-screen"><p role="status">Открываем прогулки…</p></main>}><WalkScreen /></Suspense>;
}

export const metadata = siteMetadata("ru", "/walk");
