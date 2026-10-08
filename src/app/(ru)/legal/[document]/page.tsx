import { notFound } from "next/navigation";
import { LegalDocument, legalTitles, type LegalDocumentName } from "@/features/legal/documents";
import type { Metadata } from "next";

export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(legalTitles).map(document => ({ document }));
}
function documentName(value: string): LegalDocumentName {
  if (!Object.hasOwn(legalTitles, value)) notFound();
  return value as LegalDocumentName;
}
export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const name = documentName((await params).document);
  return { title: `${legalTitles[name]} — Отголосок`, robots: { index: false, follow: true } };
}
export default async function LegalPage({ params }: { params: Promise<{ document: string }> }) {
  return <LegalDocument name={documentName((await params).document)} />;
}
