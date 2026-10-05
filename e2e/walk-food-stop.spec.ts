import { test, expect, type Page } from "./support/test";
import { draftToWalkDocument } from "../src/features/walks/adapters";
import type { FoodPlace } from "../src/features/food/types";
import type { WalkDocument } from "../src/features/walks/model";

// A walk north along one street: the start, three stops at vertices 1..3 and the finish.
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const geometry = [0, 1, 2, 3, 4].map(i => ({ lat: 55.74 + i * .001, lon: 37.61 }));
const start = { address: "Начало прогулки", location: geometry[0] };
const destination = { address: "Финиш прогулки", location: geometry[4] };
const stops = geometry.slice(1, 4).map((location, i) => ({ address: `Остановка ${i + 1}`, location }));
// The bakery stands between stops 1 and 2, the café between stops 2 and 3.
const bakery: FoodPlace = { id: "osm:node:11", kind: "bakery", name: "Пекарня по пути", lat: 55.7415, lon: 37.6106, address: null, openingHours: null, cuisine: null, website: null, phone: null };
const cafe: FoodPlace = { ...bakery, id: "osm:node:12", kind: "cafe", name: "Кафе у сквера", lat: 55.7425 };
const etag = "c".repeat(32);
const manifest = { version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T10:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: 1114, lon: 752, count: 2, etag }] };

const document = () => draftToWalkDocument({ version: 1, title: "Прогулка с перекусом", start, destination, mode: "open", minutes: 30,
  stops, route: { stops, geometry, distanceM: 445, walkingMinutes: 6, attribution: "OSM" }, jobs: [], submitting: null }, id);

/** Mocks the API; /api/walk-plan routes from the leg start through the venue to the leg end. */
async function mockApi(page: Page, { share = false }: { share?: boolean } = {}) {
  const plans: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", route => route.fulfill({ json: { user: null } }));
  await page.route("**/api/food/**", route => {
    const isManifest = new URL(route.request().url()).pathname === "/api/food/cells";
    return route.fulfill({ headers: { ETag: `"${etag}"` }, json: isManifest ? manifest : { lat: 1114, lon: 752, places: [bakery, cafe] } });
  });
  await page.route("**/api/walk-plan", route => {
    const body = route.request().postDataJSON();
    plans.push(body);
    const venue = body.stops[0];
    return route.fulfill({ json: { stops: [venue], geometry: [body.start.location, venue.location, body.destination.location], distanceM: 180, walkingMinutes: 3, attribution: "OSM" } });
  });
  if (share) await page.route("**/api/story-walks/shared/share-token", route => route.fulfill({ json: {
    document: { ...document(), id: "shared-walk" }, revision: 2, contentVersion: "shared:2",
    chapters: document().stops.map(stop => ({ id: stop.id, status: "not_requested", story: null, audio: null })) } }));
  return plans;
}
async function openLocal(page: Page) {
  const plans = await mockApi(page);
  await page.addInitScript(({ id, document }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("otgolosok:walks:v2", JSON.stringify({ version: 2, legacyId: null, items: { [id]: { document, revision: 0 } } }));
  }, { id, document: document() });
  await page.goto(`/walk?local=${id}`);
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await expect(page.getByRole("heading", { name: "Прогулка с перекусом", exact: true })).toBeVisible();
  return plans;
}
const foodButton = (page: Page) => page.getByRole("button", { name: "Поесть рядом", exact: true });
const drawer = (page: Page) => page.getByRole("region", { name: "Заведения вдоль маршрута" });
const add = (page: Page, place: FoodPlace) => drawer(page).getByRole("button", { name: `Добавить «${place.name}» в прогулку` });
const savedWalks = (page: Page) => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("otgolosok:walks:v2")!).items) as Array<{ document: WalkDocument; revision: number }>);

test("заведение становится остановкой между соседними и сохраняется в своей прогулке", async ({ page }) => {
  const plans = await openLocal(page);
  await foodButton(page).click();
  await add(page, bakery).click();
  await expect(drawer(page).getByRole("status")).toHaveText("«Пекарня по пути» добавлено в прогулку.");
  await expect(drawer(page).getByText("В прогулке", { exact: true })).toHaveCount(1);
  await expect(add(page, cafe)).toBeEnabled();
  // The way runs from stop 1 through the bakery to stop 2.
  expect(plans).toEqual([expect.objectContaining({ start: { address: "Точка маршрута", location: geometry[1] }, destination: { address: "Точка маршрута", location: geometry[2] }, mode: "open", minutes: 90 })]);
  const [saved] = await savedWalks(page);
  expect(saved.revision).toBe(1);
  expect(saved.document.stops.map(stop => stop.place.address)).toEqual(["Остановка 1", "Пекарня по пути", "Остановка 2", "Остановка 3"]);
  expect(saved.document.route!.geometry).toContainEqual({ lat: bakery.lat, lon: bakery.lon });
  // The venue is drawn once, as stop 2.
  await expect(page.locator('[data-marker="food"]')).toHaveCount(1);
  await foodButton(page).click();
  await expect(page.getByRole("button", { name: "Остановки · 4" })).toBeVisible();
  // It survives a reload: the walk is saved, not only shown.
  await page.reload();
  await expect(page.getByRole("button", { name: "Остановки · 4" })).toBeVisible();
});

test("во время прогулки заведение на текущем участке становится следующей целью", async ({ page }) => {
  await openLocal(page);
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByRole("button", { name: "Остановка 2 из 3" })).toBeVisible();
  await foodButton(page).click();
  // The bakery lies on the way from stop 1 to stop 2, which the walker is walking now.
  await add(page, bakery).click();
  await expect(drawer(page).getByRole("status")).toHaveText("«Пекарня по пути» добавлено в прогулку.");
  await foodButton(page).click();
  await expect(page.getByRole("button", { name: "Остановка 2 из 4" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пекарня по пути", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Остановка 2", exact: true })).toBeVisible();
  // Reopened, the list no longer repeats the old notice and still marks the venue as a stop.
  await foodButton(page).click();
  await expect(drawer(page).getByRole("status")).toHaveCount(0);
  await expect(drawer(page).getByText("В прогулке", { exact: true })).toHaveCount(1);
  await expect(add(page, cafe)).toBeVisible();
});

test("чужая прогулка копируется на устройство, а открытая страница остаётся на месте", async ({ page }) => {
  await mockApi(page, { share: true });
  await page.goto("/walk?share=share-token");
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await foodButton(page).click();
  await add(page, cafe).click();
  await expect(drawer(page).getByRole("status")).toHaveText("«Кафе у сквера» добавлено в прогулку. Копия прогулки сохранена на этом устройстве.");
  const [copy] = await savedWalks(page);
  expect(copy.document.id).not.toBe("shared-walk");
  expect(copy.document.stops).toHaveLength(4);
  await expect(page).toHaveURL(`/walk?local=${copy.document.id}`);
  // The walk that was running goes on: the page was not reloaded.
  await expect(page.getByRole("button", { name: "Прервать прогулку" })).toBeVisible();
});

test("отказ маршрутизатора объясняется и ничего не меняет", async ({ page }) => {
  await openLocal(page);
  await page.route("**/api/walk-plan", route => route.fulfill({ status: 404, json: { error: { code: "WALK_NOT_FOUND", message: "Отсюда не получилось проложить пешеходную прогулку." } } }));
  await foodButton(page).click();
  await add(page, bakery).click();
  await expect(drawer(page).getByRole("status")).toHaveText("Не получилось проложить пешеходный путь к этому заведению.");
  await expect(add(page, bakery)).toBeEnabled();
  expect((await savedWalks(page))[0].revision).toBe(0);
});

test("выбранное заведение выделяется на карте", async ({ page }) => {
  await openLocal(page);
  await foodButton(page).click();
  const marker = page.locator('[data-marker="food"][title="Кафе у сквера"]');
  const size = () => marker.locator("svg").evaluate(svg => svg.getBoundingClientRect().width);
  const before = await size();
  await drawer(page).getByRole("button", { name: /^Кафе у сквера/ }).click();
  await expect(marker).toHaveAttribute("data-selected", "true");
  await expect.poll(size).toBeGreaterThan(before + 10);
  await expect(page.getByRole("region", { name: "Заведение", exact: true }).getByRole("button", { name: "Добавить в прогулку" })).toBeVisible();
});
