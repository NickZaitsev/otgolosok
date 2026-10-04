import { test, expect } from "./support/test";
import { openAroundFood, showAroundFood, openAroundFoodCard, foodToggle, aroundFoodPlaces } from "./support/around-food";
import { expectLayout } from "./support/layout";

for (const [width, height] of [[390, 844], [1440, 900], [568, 400], [320, 568]]) {
  test(`Еда: метки, карточка и layout-invariants ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await openAroundFood(page);
    await showAroundFood(page);
    await expectLayout(page, { screen: "Рядом", state: "еда", layout: { name: `${width}×${height}`, viewport: { width, height } }, browserName: info.project.name, options: { map: true }, known: [] });
    const shot = (name: string) => width === 390 ? page.screenshot({ path: `scratchpad/codex/shots/around-food-${name}.png` }) : Promise.resolve();
    await shot("markers");
    await openAroundFoodCard(page);
    const card = page.getByRole("region", { name: "Заведение", exact: true });
    await expect(card).toContainText("Открыто круглосуточно");
    await expect(card).toContainText("© участники OpenStreetMap");
    await expect(card).toContainText("2 октября 2026");
    await expect(card.getByText(/м от вас/)).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Назад к списку" })).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Сайт" })).toHaveAttribute("rel", "noopener noreferrer");
    await expect(card.getByRole("link", { name: "Позвонить" })).toHaveAttribute("href", "tel:+79991234567");
    await expectLayout(page, { screen: "Рядом", state: "карточка заведения", layout: { name: `${width}×${height}`, viewport: { width, height } }, browserName: info.project.name, options: { map: true, focus: "marker" }, known: [] });
    await shot("card");
    await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
    await expect(page.locator('[data-sheet="food"]')).toHaveCount(0);
    await foodToggle(page).click();
    await expect(page.locator('[data-marker="food"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("порог 15, выключено по умолчанию и сохранение при перезагрузке", async ({ page }) => {
  const api = await openAroundFood(page);
  await expect(foodToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-marker="food"]')).toHaveCount(0);
  await foodToggle(page).click();
  await expect(page.getByText("Приблизьте карту, чтобы увидеть заведения")).toBeVisible();
  expect(api.requests).toEqual(["/api/food/cells"]);
  await page.getByRole("button", { name: "Приблизить", exact: true }).click();
  await expect(page.locator('[data-marker="food"]')).toHaveCount(2);
  await expect(page.getByText("Приблизьте карту, чтобы увидеть заведения")).toHaveCount(0);
  await page.reload();
  await expect(foodToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Приблизьте карту, чтобы увидеть заведения")).toBeVisible();
  await page.getByRole("button", { name: "Приблизить", exact: true }).click();
  await expect(page.locator('[data-marker="food"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Отдалить", exact: true }).click();
  await expect(page.locator('[data-marker="food"]')).toHaveCount(0);
  await foodToggle(page).click();
  await page.reload();
  await expect(foodToggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("история и заведение взаимоисключаются; истории выше и не смешиваются с food", async ({ page }) => {
  await openAroundFood(page); await showAroundFood(page);
  await page.getByTitle("История площади", { exact: true }).click();
  await expect(page.locator('[data-sheet="story"]')).toBeVisible();
  await openAroundFoodCard(page);
  await expect(page.locator('[data-sheet="story"]')).toHaveCount(0);
  expect(await page.locator(".leaflet-food-pane").evaluate(el => Number(getComputedStyle(el).zIndex))).toBeLessThan(await page.locator(".leaflet-marker-pane").evaluate(el => Number(getComputedStyle(el).zIndex)));
  await expect(page.locator('.leaflet-food-pane [data-marker="food"]')).toHaveCount(2);
  await expect(page.locator('.leaflet-marker-pane [data-marker="food"]')).toHaveCount(0);
  await page.getByTitle("История площади", { exact: true }).click();
  await expect(page.locator('[data-sheet="food"]')).toHaveCount(0);
  await expect(page.locator('[data-sheet="story"]')).toBeVisible();
});

test("геопозиция даёт расстояние по прямой", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: aroundFoodPlaces[0].lat, longitude: aroundFoodPlaces[0].lon, accuracy: 10 });
  await openAroundFood(page);
  await page.getByRole("button", { name: "Моё местоположение", exact: true }).click();
  await expect(page.locator('[data-marker="user"]')).toHaveCount(1);
  await foodToggle(page).click();
  // Locating focuses the map at zoom 17.
  await expect(page.locator('[data-marker="food"]')).toHaveCount(2);
  await openAroundFoodCard(page);
  await expect(page.getByText("≈ 0 м от вас", { exact: true })).toBeVisible();
});

for (const failure of ["network", "500", "manifest"] as const) test(`ошибка ${failure}: три попытки и восстановление`, async ({ page }) => {
  const api = await openAroundFood(page, { failure });
  if (failure !== "manifest") { await foodToggle(page).click(); await page.getByRole("button", { name: "Приблизить", exact: true }).click(); }
  await expect(page.getByText("Не удалось загрузить заведения", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(api.attempts()).toBe(3);
  api.recover();
  await page.getByRole("button", { name: "Повторить загрузку заведений" }).click();
  await expect(page.getByText("Не удалось загрузить заведения", { exact: true })).toHaveCount(0);
  if (failure === "manifest") await showAroundFood(page);
  await expect(page.locator('[data-marker="food"]')).toHaveCount(2);
});

test("503 прячет переключатель без ошибки и повторов", async ({ page }) => {
  const api = await openAroundFood(page, { unavailable: true });
  await expect.poll(() => api.requests.length).toBe(1);
  await expect(foodToggle(page)).toHaveCount(0);
  await expect(page.getByText("Не удалось загрузить заведения")).toHaveCount(0);
});
test("без хранилища переключатель работает", async ({ page }) => {
  await openAroundFood(page, { storage: false }); await showAroundFood(page); await openAroundFoodCard(page);
  await expect(page.getByRole("heading", { name: aroundFoodPlaces[0].name })).toBeVisible();
});
test("создание прогулки не загружает заведения и не показывает переключатель", async ({ page }) => {
  const api = await openAroundFood(page, { path: "/?walk=create" });
  await expect(page.getByRole("button", { name: "Откуда", exact: true })).toBeVisible();
  await expect(foodToggle(page)).toHaveCount(0);
  expect(api.requests).toEqual([]);
});
