import { notFound } from "next/navigation";
import manifest from "../../manifest";
export const dynamic = "force-static";
export function generateStaticParams() { return [{ locale: "en" }, { locale: "zh" }]; }
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return Response.json({ ...manifest(),
    name: locale === "en" ? "Otgolosok — audio walks around Moscow and Kazan" : "Otgolosok — 莫斯科和喀山语音漫步",
    description: locale === "en" ? "The city's stories, right here." : "聆听身边的城市故事。",
    lang: locale === "zh" ? "zh-Hans" : "en", start_url: `/${locale}`,
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
