import { chromium, type FullConfig } from "@playwright/test";

/**
 * The dev server compiles the map's lazy chunks (Leaflet, MapLibre, the style) on the first request. Under a parallel
 * run the first tests to open the map waited for that compile longer than an assertion timeout and failed at random:
 * open the map once before any test, so every test gets compiled chunks.
 */
export default async function warmUpMap(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    // Only the app's own code matters here: no API calls, tiles or fonts.
    await page.route(url => url.origin !== new URL(baseURL).origin || url.pathname.startsWith("/api/"), route => route.abort());
    await page.goto("/");
    await page.locator(".leaflet-container").waitFor({ timeout: 120_000 });
    await page.getByText("Загружаем карту…").waitFor({ state: "detached", timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
