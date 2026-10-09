import { expect, test } from "./support/test";

test("мини-карта и заголовок адаптируются к ширине экрана", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.route("**/api/top-walks**", route => route.fulfill({ json: {
    walks: [{ kind: "catalog", id: "sample-route", title: "Прогулка", walkingMinutes: 30,
      distanceM: 2000, stopCount: 4, rating: { average: null, count: 0 }, rank: 1,
      preview: null, mapPreview: { zoom: 12, tiles: [{ x: 2500, y: 1300, left: 0, top: 0 }], points: [[20, 20], [200, 200]] },
      startMetro: null, endMetro: null }],
    total: 1, nextOffset: null, filters: { starts: [], ends: [] },
  } }));
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await page.goto("/trends");

  const credit = page.getByRole("link", { name: "© OpenStreetMap", exact: true });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  const position = await credit.evaluate(link => {
    const outer = link.parentElement!.getBoundingClientRect();
    const inner = link.getBoundingClientRect();
    return { inside: inner.top >= outer.top && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1,
      widthShare: inner.width / outer.width };
  });
  expect(position.inside).toBe(true);
  expect(position.widthShare).toBeLessThan(0.9);

  const preview = credit.locator("..");
  const title = page.locator("ol strong").first();
  const desktopTitleSize = await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const desktopPreview = await preview.boundingBox();
  expect(desktopPreview).not.toBeNull();
  expect(desktopPreview!.height / desktopPreview!.width).toBeCloseTo(1, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTitleSize = await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const mobilePreview = await preview.boundingBox();
  expect(mobilePreview).not.toBeNull();
  expect(mobileTitleSize).toBeLessThan(desktopTitleSize);
  expect(mobileTitleSize).toBeGreaterThanOrEqual(18);
  expect(mobilePreview!.height / mobilePreview!.width).toBeGreaterThan(1.2);
  expect(mobilePreview!.height / mobilePreview!.width).toBeLessThan(1.3);
});
