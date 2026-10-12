import { test, expect, type Page } from "./support/test";
import { mockGuestApi } from "./support/scenarios";
import { mockMapCatalog } from "./support/map-catalog";
import { expectLayout } from "./support/layout";
import { MOSCOW_CENTER } from "../src/features/explore/map-jobs";

const { lat, lon } = MOSCOW_CENTER;
const card = (id: string, title: string, line: Array<[number, number]>) =>
  ({ kind: "catalog", id, title, walkingMinutes: 45, distanceM: 3200, stopCount: 6, rating: { average: 4.6, count: 3 }, line });
// A north–south and an east–west walk crossing at the start of the map.
const walks = [
  card("msk-north-south", "С севера на юг", [[lat - 0.004, lon], [lat + 0.004, lon]]),
  card("msk-west-east", "С запада на восток", [[lat, lon - 0.008], [lat, lon + 0.008]]),
];

async function openAroundWalks(page: Page) {
  await mockGuestApi(page);
  await page.addInitScript(() => localStorage.setItem("otgolosok:explore:geo-prompt-dismissed", "1"));
  await mockMapCatalog(page, []);
  const requests: string[] = [];
  await page.route("**/api/walks/map?**", route => {
    requests.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { walks } });
  });
  await page.goto("/");
  await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
  return { requests };
}
const toggle = (page: Page) => page.getByRole("button", { name: "Прогулки на карте", exact: true });
/** Screen point of a walk line at a fraction of its length. */
const pointOn = (page: Page, key: string, fraction: number) => page.locator(`[data-walk-line="${key}"]`).evaluate((path: SVGPathElement, at) => {
  const point = path.getPointAtLength(path.getTotalLength() * at), matrix = path.getScreenCTM()!;
  return { x: point.x * matrix.a + point.y * matrix.c + matrix.e, y: point.x * matrix.b + point.y * matrix.d + matrix.f };
}, fraction);

test("прогулки на карте: линии, карточка по тапу, выбор из пересекающихся и выключение", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { requests } = await openAroundWalks(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(requests).toEqual([]);

  await toggle(page).click();
  await expect(page.locator("[data-walk-line]")).toHaveCount(2);
  // One request for twice the view, on the 0,01° grid.
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatch(/^\?west=\d+\.\d{2}&south=\d+\.\d{2}&east=\d+\.\d{2}&north=\d+\.\d{2}$/);

  // Near the end of the north–south line only that walk is under the finger: its card opens at once.
  const lone = await pointOn(page, "catalog:msk-north-south", 0.9);
  await page.mouse.click(lone.x + 8, lone.y);
  const sheet = page.locator('[data-sheet="walk-overview"]');
  await expect(sheet).toContainText("С севера на юг");
  await expect(sheet).toContainText("45 мин · 3,2 км · 6 историй");
  await expect(sheet.getByRole("link", { name: "Открыть прогулку" })).toHaveAttribute("href", "/walk?catalog=msk-north-south");
  await expect(page.locator('[data-walk-selected="catalog:msk-north-south"]')).toHaveCount(1);
  await expectLayout(page, { screen: "Рядом", state: "карточка прогулки", layout: { name: "390×844", viewport: { width: 390, height: 844 } }, browserName: info.project.name, options: { map: true }, known: [] });

  // Where both lines cross, both walks are offered and the choice moves the highlight.
  const crossing = await pointOn(page, "catalog:msk-north-south", 0.5);
  await page.mouse.click(crossing.x, crossing.y);
  await expect(sheet).toContainText("Прогулок здесь: 2");
  await sheet.getByRole("button", { name: /С запада на восток/ }).click();
  await expect(page.locator('[data-walk-selected="catalog:msk-west-east"]')).toHaveCount(1);
  await expect(sheet.getByRole("link", { name: "Открыть прогулку" })).toHaveAttribute("href", "/walk?catalog=msk-west-east");

  // Switching the layer off closes the card and removes the lines; the choice survives a reload.
  await toggle(page).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator("[data-walk-line]")).toHaveCount(0);
  await toggle(page).click();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-walk-line]")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("с клавиатуры прогулки области открываются списком без касания линий", async ({ page }) => {
  await openAroundWalks(page);
  await toggle(page).click();
  await expect(page.locator("[data-walk-line]")).toHaveCount(2);
  const list = page.getByRole("button", { name: "Список прогулок на карте: 2", exact: true });
  await list.focus();
  await expect(list).toBeVisible();
  await page.keyboard.press("Enter");
  const sheet = page.locator('[data-sheet="walk-overview"]');
  await expect(sheet).toContainText("Прогулок здесь: 2");
  // Список ничего не выбирает сам: карта не двигается, пока человек не выберет прогулку.
  await expect(page.locator("[data-walk-selected]")).toHaveCount(0);
  await sheet.getByRole("button", { name: /С севера на юг/ }).press("Enter");
  await expect(sheet.getByRole("link", { name: "Открыть прогулку" })).toHaveAttribute("href", "/walk?catalog=msk-north-south");
});

test("без хранилища прогулок (503) кнопка слоя исчезает", async ({ page }) => {
  await mockGuestApi(page);
  await page.addInitScript(() => localStorage.setItem("otgolosok:around:walks:v1", "1"));
  await mockMapCatalog(page, []);
  await page.route("**/api/walks/map?**", route => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Нет" } } }));
  await page.goto("/");
  await expect(toggle(page)).toHaveCount(0);
});
