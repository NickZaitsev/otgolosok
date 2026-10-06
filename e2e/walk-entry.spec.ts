import { expect, test } from "./support/test";
import { draftToWalkDocument, routeToWalkView, walkViewToRoute } from "../src/features/walks/adapters";
import routeData from "../public/data/routes/paveletskaya.json" with { type: "json" };
import type { Route } from "../src/features/tour/types";

const view = routeToWalkView(routeData as Route);
const route = walkViewToRoute(view);
const entry = route.walk!.steps[2];

test("вход с промежуточной остановки игнорирует сохранённые направление и прогресс", async ({ page }) => {
  const first = route.walk!.steps[0];
  await page.addInitScript(({ routeId, first }) => {
    localStorage.setItem(`otgolosok:walk-direction:${routeId}`, "reverse");
    localStorage.setItem(`otgolosok:playback:${routeId}`, JSON.stringify({
      version: 1, routeId, chapterId: first.id, audioUrl: first.audio!.url, positionSec: 30,
    }));
  }, { routeId: route.id, first });
  await page.route("**/api/story-walks/paveletskaya/view", request => request.fulfill({ json: view }));
  await page.goto(`/walk?catalog=paveletskaya&fromStop=${encodeURIComponent(entry.id)}`);
  await expect(page.getByText(`Начало с остановки «${entry.title}».`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Пройти прогулку с конца" })).toHaveCount(0);
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await expect(page.getByRole("heading", { name: entry.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Остановка 3 из ${route.walk!.steps.length}` })).toBeVisible();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByRole("heading", { name: route.walk!.steps[3].title, exact: true })).toBeVisible();
});

for (const fromStop of ["", "deleted-stop"]) {
  test(`недействительная точка входа ${JSON.stringify(fromStop)} не начинает прогулку с начала`, async ({ page }) => {
    await page.route("**/api/story-walks/paveletskaya/view", request => request.fulfill({ json: view }));
    await page.goto(`/walk?catalog=paveletskaya&fromStop=${fromStop}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Точка начала больше не входит в эту прогулку. Откройте подборку заново.");
    await expect(page.getByRole("button", { name: "Начать прогулку", exact: true })).toHaveCount(0);
  });
}

test("перенесённая каталожная прогулка сохраняет промежуточную точку входа", async ({ page }) => {
  const share = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await page.route("**/api/story-walks/paveletskaya/view", request => request.fulfill({ status: 410, json: { error: { code: "WALK_MOVED", share } } }));
  await page.route(`**/api/story-walks/shared/${share}`, request => request.fulfill({ json: view }));
  await page.goto(`/walk?catalog=paveletskaya&fromStop=${encodeURIComponent(entry.id)}`);
  await expect(page).toHaveURL(new RegExp(`/walk\\?share=${share}&fromStop=`));
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await expect(page.getByRole("heading", { name: entry.title, exact: true })).toBeVisible();
});

test("ссылка создания на Тверской открывает остаток готовой прогулки и начинает выбранную остановку", async ({ page }) => {
  await page.route("**/api/walks/nearby?*", request => request.fulfill({ json: { walks: [{
    kind: "catalog", id: "paveletskaya", title: "Готовая прогулка", entryStopId: entry.id,
    walkingMinutes: 45, distanceM: 3200, stopCount: 6, audioMinutes: 18, audioComplete: true,
    startDistanceM: 50, finish: "Москва, Садовническая улица, 5", rating: { average: null, count: 0 },
  }] } }));
  await page.route("**/api/story-walks/paveletskaya/view", request => request.fulfill({ json: view }));
  const params = new URLSearchParams({ walk: "create", address: "Москва, Тверская улица, 16 с1", lat: "55.7645597", lon: "37.6065573" });
  await page.goto(`/?${params}`);
  const nearby = page.locator('[data-sheet="creation"] [data-creation="nearby"]');
  await nearby.getByText("Прогулки рядом · 1", { exact: true }).click();
  const card = nearby.getByRole("link", { name: /Готовая прогулка/ });
  await expect(card).toContainText("Осталось 3,2 км · 6 точек · 18 мин озвучки");
  await card.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("fromStop")).toBe(entry.id);
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await expect(page.getByRole("heading", { name: entry.title, exact: true })).toBeVisible();
});

test("добавление заведения до старта сохраняет промежуточный вход в копии чужой прогулки", async ({ page }) => {
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const geometry = [0, 1, 2, 3, 4].map(i => ({ lat: 55.74 + i * .001, lon: 37.61 }));
  const start = { address: "Начало прогулки", location: geometry[0] };
  const destination = { address: "Финиш прогулки", location: geometry[4] };
  const stops = geometry.slice(1, 4).map((location, i) => ({ address: `Остановка ${i + 1}`, location }));
  const document = draftToWalkDocument({ version: 1, title: "Вход по пути", start, destination, mode: "open", minutes: 30,
    stops, route: { stops, geometry, distanceM: 445, walkingMinutes: 6, attribution: "OSM" }, jobs: [], submitting: null }, id);
  const selectedStop = document.stops[1];
  const cafe = { id: "osm:node:12", kind: "cafe", name: "Кафе у сквера", lat: 55.7425, lon: 37.6106, address: null, openingHours: null, cuisine: null, website: null, phone: null };
  const etag = "c".repeat(32);
  await page.route("**/api/**", request => request.fulfill({ json: { user: null } }));
  await page.route("**/api/story-walks/shared/share-token", request => request.fulfill({ json: {
    document, revision: 2, contentVersion: "shared:2", chapters: document.stops.map(stop => ({ id: stop.id, status: "not_requested", story: null, audio: null })),
  } }));
  await page.route("**/api/food/**", request => request.fulfill({ headers: { ETag: `"${etag}"` }, json: new URL(request.request().url()).pathname === "/api/food/cells"
    ? { version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T10:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: 1114, lon: 752, count: 1, etag }] }
    : { lat: 1114, lon: 752, places: [cafe] } }));
  await page.route("**/api/walk-plan", request => {
    const body = request.request().postDataJSON();
    return request.fulfill({ json: { stops: body.stops, geometry: [body.start.location, body.stops[0].location, body.destination.location], distanceM: 180, walkingMinutes: 3, attribution: "OSM" } });
  });
  await page.goto(`/walk?share=share-token&fromStop=${selectedStop.id}`);
  await page.getByRole("button", { name: "Поесть рядом", exact: true }).click();
  await page.getByRole("region", { name: "Заведения вдоль маршрута" }).getByRole("button", { name: `Добавить «${cafe.name}» в прогулку` }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("local")).toBeTruthy();
  await expect.poll(() => new URL(page.url()).searchParams.get("fromStop")).toBe(selectedStop.id);
  await page.getByRole("button", { name: "Поесть рядом", exact: true }).click();
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Остановка 2", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Остановка 2", exact: true })).toBeVisible();
});
