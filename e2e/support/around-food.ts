import { expect, type Page } from "./test";
import { mockGuestApi } from "./scenarios";
import { mockMapCatalog } from "./map-catalog";
import { MOSCOW_CENTER } from "../../src/features/explore/map-jobs";
import { foodPlace } from "../../src/features/food/test-fixtures";

export const aroundFoodPlaces = [
  { ...foodPlace("osm:node:1", MOSCOW_CENTER.lat, MOSCOW_CENTER.lon), name: "Кофе у площади", openingHours: "24/7; PH off", website: "https://example.com/menu", phone: "+7 (999) 123-45-67", address: "Москва, Тестовая улица, 1" },
  { ...foodPlace("osm:node:2", MOSCOW_CENTER.lat + .0005, MOSCOW_CENTER.lon + .0008), name: "Пекарня рядом", kind: "bakery" as const },
];
export async function openAroundFood(page: Page, options: { unavailable?: boolean; failure?: "network" | "500" | "manifest"; path?: string; storage?: boolean } = {}) {
  await mockGuestApi(page);
  await page.addInitScript(() => localStorage.setItem("otgolosok:explore:geo-prompt-dismissed", "1"));
  if (options.storage === false) await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === "otgolosok:around:food:v1") throw new Error("Storage unavailable"); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === "otgolosok:around:food:v1") throw new Error("Storage unavailable"); return set.call(this, key, value); };
  });
  await mockMapCatalog(page, [{ id: "osm:node:1", title: "История площади", ...MOSCOW_CENTER, paragraphs: ["История этого места."] }]);
  const requests: string[] = [];
  let failing = Boolean(options.failure), attempts = 0;
  await page.route("**/api/food/**", async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (options.unavailable) return route.fulfill({ status: 503, json: { error: "FOOD_INDEX_UNAVAILABLE" } });
    const manifest = path === "/api/food/cells";
    if (failing && (options.failure === "manifest" ? manifest : !manifest)) {
      attempts++;
      if (options.failure === "network") return route.abort("failed");
      return route.fulfill({ status: 500, json: { error: "FAILED" } });
    }
    const etag = "a".repeat(32);
    return route.fulfill({ headers: { ETag: `"${etag}"` }, json: manifest
      ? { version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T10:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: 1115, lon: 752, count: 2, etag }] }
      : { lat: 1115, lon: 752, places: aroundFoodPlaces } });
  });
  await page.goto(options.path ?? "/");
  await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
  return { requests, attempts: () => attempts, recover: () => { failing = false; } };
}
export const foodToggle = (page: Page) => page.getByRole("button", { name: "Еда", exact: true });
export async function showAroundFood(page: Page) {
  await foodToggle(page).click();
  await page.getByRole("button", { name: "Приблизить", exact: true }).click();
  await expect(page.locator('[data-marker="food"]')).toHaveCount(2);
}
export async function openAroundFoodCard(page: Page) {
  await page.getByTitle(aroundFoodPlaces[0].name, { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-sheet="food"]')).toBeVisible();
}
