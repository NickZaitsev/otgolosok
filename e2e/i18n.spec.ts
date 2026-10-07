import { expect, test } from "./support/test";
import { mockGuestApi, longStop } from "./support/scenarios";
import { mockMapCatalog } from "./support/map-catalog";
import { MOSCOW_CENTER } from "../src/features/explore/map-jobs";

const sourceText = "Особняк перестраивали трижды, и каждый владелец оставил на фасаде свою деталь.";
const place = { id: "osm:node:1001", title: "Дом с башней", address: "Москва, Дербеневская, 1", ...MOSCOW_CENTER,
  paragraphs: [sourceText], audioUrl: "/api/story-audio/tower.mp3", durationSec: 90 };
const versions = [
  { locale: "en", html: "en", language: "Interface language", expand: "Read the full story", profile: "Profile", history: "History", login: "Sign in", password: "Password", notice: "This story's text and audio are currently available in Russian only." },
  { locale: "zh", html: "zh-Hans", language: "界面语言", expand: "阅读全文", profile: "个人资料", history: "历史记录", login: "登录", password: "密码", notice: "本故事的文字和音频目前仅提供俄语版本。" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("otgolosok:explore:geo-prompt-dismissed", "1"));
  await mockGuestApi(page);
  await mockMapCatalog(page, [place]);
});

for (const version of versions) {
  test(`${version.locale}: язык документа, история без перевода и смена языка с параметрами`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/${version.locale}?place=osm:node:1001&debug=1#story`);
    await expect(page.locator("html")).toHaveAttribute("lang", version.html);
    await expect(page.getByRole("heading", { name: place.title, exact: true })).toBeVisible();
    const sheet = page.locator('[data-sheet="story"]');
    await expect(sheet.getByText(sourceText, { exact: true })).toBeVisible();
    await expect(sheet.getByText(version.notice, { exact: true })).toBeVisible();
    const next = version.locale === "en" ? "zh" : "en";
    await page.getByRole("combobox", { name: version.language }).selectOption(next);
    await expect(page).toHaveURL(new RegExp(`/${next}\\?place=osm:node:1001&debug=1#story$`));
    await expect(page.locator("html")).toHaveAttribute("lang", next === "zh" ? "zh-Hans" : "en");
    await expect(page.getByRole("heading", { name: place.title, exact: true })).toBeVisible();
    await expect(page.locator('[data-sheet="story"]').getByText(sourceText, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${version.locale}: навигация, вход и история сохраняют язык`, async ({ page }) => {
    await page.goto(`/${version.locale}`);
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: version.history, exact: true })).toHaveAttribute("href", `/${version.locale}/history`);
    await nav.getByRole("link", { name: version.history, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${version.locale}/history$`));
    await expect(page.getByRole("navigation").getByRole("link", { name: version.profile, exact: true })).toHaveAttribute("href", `/${version.locale}/account`);
    await page.getByRole("navigation").getByRole("link", { name: version.profile, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${version.locale}/login\\?returnTo=`));
    await expect(page.getByRole("heading", { name: version.login, exact: true })).toBeVisible();
    await expect(page.getByLabel(version.password, { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });

  test(`${version.locale}: управление картой и переключатель помещаются на узком экране`, async ({ page }, info) => {
    await page.goto(`/${version.locale}`);
    if (process.env.E2E_STATIC === "1") {
      // Initial installation can reload the page through the app's safe-update flow.
      // Measure one fresh document after the worker has taken control.
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)).catch(() => false)).toBe(true);
      await page.reload();
    }
    await expect(page.getByRole("combobox", { name: version.language })).toBeVisible();
    for (const [width, height] of [[320, 568], [390, 844], [568, 320], [1280, 844]]) {
      await page.setViewportSize({ width, height });
      const header = page.locator('[data-region="header"]');
      const controls = page.locator('[data-region="controls"]');
      await expect(header).toBeVisible();
      await expect(controls).toBeVisible();
      const [h, c, select] = await Promise.all([header.boundingBox(), controls.boundingBox(), page.getByRole("combobox", { name: version.language }).boundingBox()]);
      expect(h!.x + h!.width <= c!.x + 1 || h!.y + h!.height <= c!.y + 1).toBe(true);
      expect(select!.x).toBeGreaterThanOrEqual(0);
      expect(select!.x + select!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`${version.locale}-${width}.png`), animations: "disabled" });
    }
  });
}

test("смена языка при активной прогулке отменяется или подтверждённо завершает текущую страницу", async ({ page }) => {
  await page.route("**/api/story-walks/paveletskaya/view", route => route.fulfill({ json: longStop }));
  await page.goto("/en/walk?catalog=paveletskaya");
  await page.getByRole("button", { name: "Start walk", exact: true }).click();
  await expect(page.getByRole("button", { name: "End walk", exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh");
  await expect(page).toHaveURL(/\/en\/walk\?catalog=paveletskaya$/);
  await expect(page.getByRole("combobox", { name: "Interface language" })).toHaveValue("en");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh");
  await expect(page).toHaveURL(/\/zh\/walk\?catalog=paveletskaya$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
});

test("языковые оболочки открываются без сети из production-кеша", async ({ page, context }) => {
  test.skip(process.env.E2E_STATIC !== "1", "Проверка Service Worker запускается на статическом production-экспорте.");
  await page.goto("/en");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active && !navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.goto("/zh/history");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("navigation").getByRole("link", { name: "历史记录", exact: true })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "附近", exact: true }).click();
  await expect(page).toHaveURL(/\/zh$/);
  await page.getByRole("navigation").getByRole("link", { name: "历史记录", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/history$/);
  await page.goto("/en/login");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
});
