import { expect, test } from "./support/test";
import { carWalkDocument } from "../backend/test-fixtures/car-walk.mjs";
import type { WalkView } from "../src/features/walks/model";

for (const width of [390, 1280]) {
  test(`поездка с парковкой, возвратом и сохранением прогресса при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const document = carWalkDocument() as WalkView["document"];
    const view: WalkView = { document, revision: 0, contentVersion: "test:car", chapters: [{ id: "car-stop-1", status: "text_ready",
      story: { title: "История дома", address: "Москва, исторический дом", paragraphs: [{ text: "История этого дома.", factIds: [] }], sources: [], facts: [] }, audio: null }] };
    await page.route("**/api/story-walks/car-walk/view*", route => route.fulfill({ json: view }));
    await page.goto("/walk?catalog=car-walk");
    await expect(page.getByRole("button", { name: "Начать поездку" })).toBeVisible();
    await page.getByRole("button", { name: "Начать поездку" }).click();
    await expect(page.getByRole("link", { name: "Маршрут в навигаторе" })).toHaveAttribute("href", /rtt=auto/);
    await expect(page.getByText("В дороге звук остановлен")).toBeVisible();
    await expect(page.locator("audio")).not.toHaveAttribute("src");
    await page.getByRole("button", { name: "Я припарковался / Начать прогулку" }).click();
    await expect(page.getByRole("heading", { name: "История дома", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "История дома", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Вернуться к машине", exact: true }).click();
    await expect(page.getByRole("link", { name: "Маршрут к машине" })).toHaveAttribute("href", /rtt=pd/);
    await page.getByRole("button", { name: "Я у машины", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Поездка завершена" })).toBeVisible();
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
