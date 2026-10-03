import { expect, test, type Page } from "./support/test";
import { mockMapCatalog } from "./support/map-catalog";
import { MOSCOW_CENTER } from "../src/features/explore/map-jobs";

const id = "osm:node:999999990", title = "Парк у реки";
type Vote = { rating: 1 | -1; issues: string[]; text: string; status: string; updatedAt: string } | null;
async function setup(page: Page) {
  let mine: Vote = null;
  const writes: unknown[] = [];
  await page.route("**/api/**", route => route.fulfill({ json: { user: null, items: [], walks: [] } }));
  await mockMapCatalog(page, [{ id, title, address: "Москва", lat: MOSCOW_CENTER.lat, lon: MOSCOW_CENTER.lon, paragraphs: ["История парка. ".repeat(80)] }]);
  await page.route(`**/api/content/places/${id}/feedback/mine`, async route => {
    if (route.request().method() === "PUT") {
      const input = route.request().postDataJSON();
      writes.push(input);
      expect(route.request().headers()["x-review-key"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      mine = input.rating === null ? null : { ...input, status: "open", updatedAt: "2026-10-02T10:00:00Z" };
    }
    await route.fulfill({ json: { mine } });
  });
  await page.goto("/");
  await page.getByTitle(title, { exact: true }).click();
  await expect(page.getByRole("button", { name: "Нравится", exact: true })).toBeEnabled();
  return { writes };
}

test("лайк меняется на дизлайк, форма принимает причины и текст, оценка остаётся после перезагрузки", async ({ page }, info) => {
  const { writes } = await setup(page);
  const like = page.getByRole("button", { name: "Нравится", exact: true });
  const dislike = page.getByRole("button", { name: "Не нравится", exact: true });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await dislike.click();
  const dialog = page.getByRole("dialog", { name: "Что улучшить в этом месте?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Не нравится озвучка").check();
  await dialog.getByLabel(/Ваш комментарий/).fill("Расскажите подробнее о старом мосте.");
  await page.screenshot({ path: info.outputPath("improvement-form.png") });
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(dislike).toHaveAttribute("aria-pressed", "true");
  expect(writes.at(-1)).toEqual({ rating: -1, issues: ["voiceover"], text: "Расскажите подробнее о старом мосте." });
  await page.reload();
  await page.getByTitle(title, { exact: true }).click();
  await expect(dislike).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Что можно улучшить?" }).click();
  await expect(dialog.getByLabel(/Ваш комментарий/)).toHaveValue("Расскажите подробнее о старом мосте.");
  await expect(dialog.getByLabel("Не нравится озвучка")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await dislike.click();
  await expect(dislike).toHaveAttribute("aria-pressed", "false");
  expect(writes.at(-1)).toEqual({ rating: null, issues: [], text: "" });
});

test("дизлайк сохраняется без пояснения; можно отправить только текст", async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Не нравится", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Что улучшить в этом месте?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Не нравится", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Что можно улучшить?" }).click();
  await dialog.getByLabel(/Ваш комментарий/).fill("Больше деталей");
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes.at(-1)).toEqual({ rating: -1, issues: [], text: "Больше деталей" });
});

test("ошибка записи не меняет оценку и сохраняет черновик комментария", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Не нравится", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Что улучшить в этом месте?" });
  await dialog.getByLabel(/Ваш комментарий/).fill("Нужны подробности");
  await page.route(`**/api/content/places/${id}/feedback/mine`, route => route.fulfill({ status: 400, json: { error: { code: "BAD_REQUEST", message: "Не удалось сохранить комментарий." } } }));
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Не удалось сохранить комментарий.");
  await expect(dialog.getByLabel(/Ваш комментарий/)).toHaveValue("Нужны подробности");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Нравится", exact: true }).click();
  await expect(page.getByRole("button", { name: "Не нравится", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Нравится", exact: true })).toHaveAttribute("aria-pressed", "false");
});

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`оценка и форма доступны на экране ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await setup(page);
    const like = page.getByRole("button", { name: "Нравится", exact: true });
    const dislike = page.getByRole("button", { name: "Не нравится", exact: true });
    await expect(like).toBeInViewport();
    await expect(dislike).toBeInViewport();
    expect(await like.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await dislike.click();
    const dialog = page.getByRole("dialog", { name: "Что улучшить в этом месте?" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath("form.png") });
    await page.keyboard.press("Escape");
    await expect(dislike).toBeFocused();
    await page.screenshot({ path: info.outputPath("card.png") });
  });
}
