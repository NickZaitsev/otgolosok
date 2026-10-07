import { expect, test } from "./support/test";
import { mockGuestApi, longStop } from "./support/scenarios";
import { mockMapCatalog } from "./support/map-catalog";
import { MOSCOW_CENTER } from "../src/features/explore/map-jobs";

const sourceText = "Особняк перестраивали трижды, и каждый владелец оставил на фасаде свою деталь.";
const place = { id: "osm:node:1001", title: "Дом с башней", address: "Москва, Дербеневская, 1", ...MOSCOW_CENTER,
  paragraphs: [sourceText], audioUrl: "/api/story-audio/tower.mp3", durationSec: 90 };
const versions = [
  { locale: "en", html: "en", language: "Interface language", expand: "Read the full story", profile: "Profile", history: "History", login: "Sign in", password: "Password", notice: "This story's text and audio are currently available in Russian only.", audioPending: "Narration in your selected language is being prepared." },
  { locale: "zh", html: "zh-Hans", language: "界面语言", expand: "阅读全文", profile: "个人资料", history: "历史记录", login: "登录", password: "密码", notice: "本故事的文字和音频目前仅提供俄语版本。", audioPending: "所选语言的音频正在制作中。" },
] as const;

const localizedPlace = {
  ...place,
  translations: {
    en: { title: "The house with a tower", paragraphs: ["The mansion was rebuilt three times, and each owner left a detail on its facade."] },
    zh: { title: "塔楼宅邸", paragraphs: ["这座宅邸曾三次改建，每位主人都在外立面上留下了自己的印记。"] },
  },
};

const russianWalkFallback = (locale: "en" | "zh") => ({
  ...longStop,
  requestedLocale: locale,
  contentVersion: `${locale}-russian-fallback`,
  chapters: longStop.chapters.map(chapter => ({ ...chapter,
    audio: chapter.audio ? { ...chapter.audio, language: "ru" as const } : null,
    localization: { requestedLocale: locale, contentLocale: "ru" as const, fallbackReason: "missing" as const },
  })),
});

const localizedWalk = (() => {
  const chapter = longStop.chapters[0], source = chapter.story!.sources[0];
  const requestedLocale = "en" as const;
  return {
    ...longStop,
    requestedLocale,
    contentVersion: "en-localized-walk",
    sourceDocument: longStop.document,
    document: {
      ...longStop.document,
      title: "Zindel Factory and the Avant-Garde",
      description: "A short walk through the history of printed textiles.",
      stops: longStop.document.stops.map(stop => ({ ...stop,
        transition: "Finish the walk at the former Zindel factory.",
        nextHint: "The walk ends by the factory buildings.",
      })),
    },
    documentLocalization: { requestedLocale, contentLocale: requestedLocale, fallbackReason: null },
    chapters: [{ ...chapter, status: "text_ready" as const, audio: null,
      localization: { requestedLocale, contentLocale: requestedLocale, fallbackReason: null },
      story: {
        title: "Patterns to Wear",
        address: chapter.story!.address,
        paragraphs: [{ text: "At the Zindel factory, an avant-garde pattern became fabric for clothes and interiors.", factIds: ["assortment"] }],
        sources: [source],
        facts: [{ id: "assortment", claim: "The factory produced patterned textiles for clothing and interiors.", sourceIds: [source.id] }],
        checkedAt: chapter.story!.checkedAt,
      },
    }],
  };
})();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("otgolosok:explore:geo-prompt-dismissed", "1"));
  await mockGuestApi(page);
  await mockMapCatalog(page, [place]);
});

for (const version of versions) {
  test(`${version.locale}: язык документа, история без перевода и смена языка с параметрами`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests = await mockMapCatalog(page, [place]);
    await page.goto(`/${version.locale}?place=osm:node:1001&debug=1#story`);
    await expect(page.locator("html")).toHaveAttribute("lang", version.html);
    await expect(page.getByRole("heading", { name: place.title, exact: true })).toBeVisible();
    const sheet = page.locator('[data-sheet="story"]');
    const sourceParagraph = sheet.getByText(sourceText, { exact: true });
    await expect(sourceParagraph).toBeVisible();
    await expect(sourceParagraph.locator("..")).toHaveAttribute("lang", "ru");
    await expect(sheet.getByText(version.notice, { exact: true })).toBeVisible();
    const next = version.locale === "en" ? "zh" : "en";
    await page.getByRole("combobox", { name: version.language }).selectOption(next);
    await expect(page).toHaveURL(new RegExp(`/${next}\\?place=osm:node:1001&debug=1#story$`));
    await expect(page.locator("html")).toHaveAttribute("lang", next === "zh" ? "zh-Hans" : "en");
    await expect(page.getByRole("heading", { name: place.title, exact: true })).toBeVisible();
    await expect(page.locator('[data-sheet="story"]').getByText(sourceText, { exact: true })).toBeVisible();
    await expect.poll(() => [...new Set(requests.filter(path => path.startsWith("/api/content/places/osm:node:1001?lang=")))]).toEqual([
      `/api/content/places/osm:node:1001?lang=${version.locale}`,
      `/api/content/places/osm:node:1001?lang=${next}`,
    ]);
    expect(errors).toEqual([]);
  });

  test(`${version.locale}: переведённая карточка без аудио использует фактический язык`, async ({ page }) => {
    const requests = await mockMapCatalog(page, [localizedPlace]);
    const translated = localizedPlace.translations[version.locale];
    await page.goto(`/${version.locale}?place=${localizedPlace.id}`);
    const sheet = page.locator('[data-sheet="story"]');

    await expect(sheet.getByRole("heading", { name: translated.title, exact: true })).toHaveAttribute("lang", version.html);
    const translatedParagraph = sheet.getByText(translated.paragraphs[0], { exact: true });
    await expect(translatedParagraph).toBeVisible();
    await expect(translatedParagraph.locator("..")).toHaveAttribute("lang", version.html);
    await expect(sheet.locator("audio")).toHaveCount(0);
    await expect(sheet.getByText(version.audioPending, { exact: true })).toBeVisible();
    await expect(sheet.getByText(version.notice, { exact: true })).toHaveCount(0);
    expect(requests).toContain(`/api/content/places/${localizedPlace.id}?lang=${version.locale}`);
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
  await page.route("**/api/story-walks/paveletskaya/view*", route => {
    const locale = new URL(route.request().url()).searchParams.get("lang") === "zh" ? "zh" : "en";
    return route.fulfill({ json: russianWalkFallback(locale) });
  });
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

test("английская прогулка получает локализованные метаданные и текст истории", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/story-walks/paveletskaya/view*", route => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    return route.fulfill({ json: localizedWalk });
  });
  await page.goto("/en/walk?catalog=paveletskaya");

  await expect(page.getByRole("heading", { name: localizedWalk.document.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start walk", exact: true }).click();
  await page.getByRole("button", { name: "Read story", exact: true }).click();
  const drawer = page.locator(".walk-session-drawer");
  await expect(drawer.locator(".story-text")).toHaveAttribute("lang", "en");
  await expect(drawer.getByText(localizedWalk.chapters[0].story.paragraphs[0].text, { exact: true })).toBeVisible();
  await expect(drawer.getByText("Narration in your selected language is being prepared.", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "How do we know this?", exact: true }).click();
  await expect(drawer.getByRole("link", { name: localizedWalk.chapters[0].story.sources[0].title, exact: true }))
    .toHaveAttribute("href", localizedWalk.chapters[0].story.sources[0].url);
  expect(requests).toContain("/api/story-walks/paveletskaya/view?lang=en");
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
