import { test, expect } from "./support/test";

const issue = (id: string, status: string, error: string | null = null) => ({
  id, walkId: id, title: id, shareToken: id, visibility: "shared", position: 1,
  status, slotAt: "2026-10-15T17:30:00Z", runId: null, youtubeUrl: null,
  telegramUrl: null, error, revision: 1, createdAt: "2026-10-14T10:00:00Z", updatedAt: "2026-10-14T10:00:00Z",
});

test("границы строк промо совпадают, ошибки объяснены, сбой действия требует обновления", async ({ page }, testInfo) => {
  let failAction = false;
  const history = [issue("Швивая горка и устье Яузы", "failed", "SUBTITLE_TRANSLATION"), issue("Тверская: переезды домов и культурная жизнь", "failed", "SCRIPT_INVALID"), issue("Опубликованная прогулка", "published"), issue("Остоженка: искусство и частная жизнь", "failed", "PHOTO_MISSING")];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "editor", role: "editor", name: "Редактор" }, session: { id: "test" } } });
    if (path === "/api/story-admin/promo-queue") return route.fulfill({ json: { items: [issue("Воздвиженка и Кисловские переулки", "queued")], history } });
    if (path.endsWith("/requeue")) return route.fulfill({ status: failAction ? 500 : 200, json: {} });
    if (path.endsWith("/shared")) return route.fulfill({ json: { walks: [], total: 0, offset: 0, hasMore: false, pending: 0 } });
    return route.fulfill({ json: { jobs: [], total: 0, hasMore: false } });
  });
  await page.goto("/admin?section=walks");
  await page.getByRole("button", { name: "Очередь промо", exact: true }).click();
  const region = page.getByRole("region", { name: "Прошедшие выпуски", exact: true });
  await expect(region.getByText("Код: PHOTO_MISSING")).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await region.locator("tbody tr").evaluateAll(rows => rows.map(row => {
      const cells = [...row.children].map(cell => ({ display: getComputedStyle(cell).display, bottom: cell.getBoundingClientRect().bottom }));
      return { cells, bottom: row.getBoundingClientRect().bottom };
    }));
    for (const row of geometry) for (const cell of row.cells) {
      expect(cell.display).toBe("table-cell");
      expect(Math.abs(cell.bottom - row.bottom)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`promo-${width}.png`), fullPage: true });
  }
  failAction = true;
  await region.getByRole("button", { name: "Вернуть в очередь: Швивая горка и устье Яузы", exact: true }).click();
  await expect(page.getByText("Результат действия не подтверждён.", { exact: false })).toBeVisible();
  await expect(region.getByRole("button").first()).toBeDisabled();
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(region.getByRole("button").first()).toBeEnabled();
});
