import { expect, test } from "./support/test";
import type { WalkView } from "../src/features/walks/model";
import type { FoodPlace } from "../src/features/food/types";

const stopId = "22222222-2222-4222-8222-222222222222";
const view: WalkView = {
  document: { version: 2, id: "11111111-1111-4111-8111-111111111111", title: "Кофе без сети", description: "", city: "Москва", mode: "open", minutes: 30,
    start: { address: "Москва, Арбат, 1", location: { lat: 55.751, lon: 37.601 } },
    stops: [{ id: stopId, place: { address: "Москва, Арбат, 10", location: { lat: 55.752, lon: 37.602 } }, storyRef: null, transition: "", nextHint: "" }],
    route: { geometry: [{ lat: 55.751, lon: 37.601 }, { lat: 55.752, lon: 37.602 }], distanceM: 130, walkingMinutes: 2, attribution: "OSM" }, fieldChecked: false },
  revision: 1, contentVersion: "offline-food-1", chapters: [{ id: stopId, status: "unavailable", story: null, audio: null }],
};
const place: FoodPlace = { id: "osm:node:1", kind: "coffee", name: "Кофе по пути", lat: 55.7515, lon: 37.6015, address: null, openingHours: "24/7", cuisine: null, website: null, phone: null };
const etag = "a".repeat(32);

for (const failure of [null, "cell", "503"] as const) {
  test(`офлайн-копия с заведениями: ${failure ?? "сохранение и открытие без сети"}`, async ({ page, context }) => {
    let offline = false;
    await page.route("**/api/**", route => {
      if (offline) return route.abort("internetdisconnected");
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/story-walks/arbat")) return route.fulfill({ json: view });
      if (path.startsWith("/api/food/")) {
        if (failure === "503") return route.fulfill({ status: 503, json: { error: "FOOD_INDEX_UNAVAILABLE" } });
        if (failure === "cell" && path !== "/api/food/cells") return route.fulfill({ status: 500, json: {} });
        return route.fulfill({ headers: { ETag: `"${etag}"` }, json: path === "/api/food/cells"
          ? { version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T10:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: 1115, lon: 752, count: 1, etag }] }
          : { lat: 1115, lon: 752, places: [place] } });
      }
      return route.fulfill({ json: { user: null } });
    });
    await page.goto("/walk?catalog=arbat");
    await page.getByRole("button", { name: /^Остановки ·/ }).click();
    await page.getByRole("button", { name: "Сохранить прогулку без сети" }).click();
    await expect(page.getByRole("button", { name: "Обновить офлайн-копию" })).toBeEnabled();
    if (failure === "cell") {
      await expect(page.getByText("Заведения не сохранены", { exact: true })).toBeVisible();
      return;
    }
    await expect(page.getByText("Офлайн-копия сохранена · 0 записей")).toBeVisible();
    await expect(page.getByText("Заведения не сохранены", { exact: true })).toHaveCount(0);
    if (failure === "503") return;

    if (process.env.FOOD_OFFLINE_PRODUCTION) await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => caches.delete("food-cells-v1"));
    offline = true;
    await context.setOffline(true);
    if (process.env.FOOD_OFFLINE_PRODUCTION) await page.reload();
    else {
      // next dev has no production shell: reopen through the app router while the network is down.
      await page.evaluate(() => history.pushState(null, "", "/walk?catalog=not-saved"));
      await expect(page.getByRole("link", { name: "Вернуться к прогулкам" })).toBeVisible({ timeout: 10_000 });
      await page.evaluate(() => history.pushState(null, "", "/walk?catalog=arbat"));
    }
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByText(/^Офлайн-копия от /)).toBeVisible();
    await page.getByRole("button", { name: "Поесть рядом", exact: true }).click();
    const drawer = page.getByRole("region", { name: "Заведения вдоль маршрута" });
    await expect(drawer.getByRole("button", { name: /Кофе по пути/ })).toBeVisible();
    await expect(drawer).toContainText("© участники OpenStreetMap");
    await drawer.getByRole("button", { name: /Кофе по пути/ }).click();
    const card = page.getByRole("region", { name: "Заведение", exact: true });
    await expect(card.getByText("Открыто круглосуточно")).toBeVisible();
    await expect(card).toContainText("2 октября 2026");
  });
}
