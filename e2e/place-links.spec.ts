import { expect, test, type Page } from "./support/test";
import { mockMapCatalog, type CatalogFixture, type CatalogOptions } from "./support/map-catalog";
import { mockGuestApi } from "./support/scenarios";
import { MOSCOW_CENTER } from "../src/features/explore/map-jobs";

// Место каталога живёт в адресе (/?place=osm:<тип>:<номер>): ссылка открывает его, «Назад» и «Вперёд» ходят по местам,
// а смена адреса никогда не перезагружает страницу.

const text = "Особняк перестраивали трижды, и каждый владелец оставил на фасаде свою деталь. ".repeat(6);
const first: CatalogFixture = { id: "osm:node:1001", title: "Дом с башней", address: "Москва, Дербеневская, 1", ...MOSCOW_CENTER,
  paragraphs: [text, text], audioUrl: "/api/story-audio/tower.mp3", durationSec: 90 };
// South of the first: apart from it at the opening zoom, and still on the map once the first is focused.
const second: CatalogFixture = { id: "osm:way:2002", title: "Фабрика у реки", address: "Москва, Кожевническая, 16",
  lat: MOSCOW_CENTER.lat - 0.005, lon: MOSCOW_CENTER.lon, paragraphs: [text] };

const here = (page: Page) => { const url = new URL(page.url()); return url.pathname + url.search; };
const card = (page: Page) => page.locator('[data-sheet="story"]');
const title = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function openMap(page: Page, places: CatalogFixture[], url = "/", options?: CatalogOptions) {
  await page.addInitScript(() => localStorage.setItem("otgolosok:explore:geo-prompt-dismissed", "1"));
  await mockGuestApi(page);
  await mockMapCatalog(page, places, options);
  await page.goto(url);
}

/** Everything after this call must happen in the same document, without a request to the server for a page. */
async function stayOnPage(page: Page) {
  const documents: string[] = [], payloads: string[] = [];
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    if (request.url().includes("_rsc=") || request.headers()["rsc"]) payloads.push(request.url());
  });
  await page.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
  await page.locator(".leaflet-container").evaluate(map => { (window as unknown as { map: Element }).map = map; });
  return async () => {
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    expect(await page.locator(".leaflet-container").evaluate(map => map === (window as unknown as { map: Element }).map)).toBe(true);
    expect(documents).toEqual([]);
    expect(payloads).toEqual([]);
  };
}

async function openPin(page: Page, name: string) {
  await page.locator(`[title="${name}"]`).dispatchEvent("click");
  await expect(title(page, name)).toBeVisible();
}

async function expand(page: Page) {
  await page.getByRole("button", { name: "Читать историю полностью" }).click();
  await expect(page.locator('[data-sheet="story"][data-expanded]')).toBeAttached();
  await page.waitForFunction(() => !document.documentElement.matches(":active-view-transition"));
}

test("каждое открытое место — шаг в адресе и истории браузера, без перезагрузки", async ({ page }) => {
  await openMap(page, [first, second]);
  await expect(page.locator(`[title="${first.title}"]`)).toBeAttached();
  const sameDocument = await stayOnPage(page);

  await openPin(page, first.title);
  expect(here(page)).toBe("/?place=osm:node:1001");
  await openPin(page, second.title);
  expect(here(page)).toBe("/?place=osm:way:2002");

  await page.goBack();
  await expect(title(page, first.title)).toBeVisible();
  expect(here(page)).toBe("/?place=osm:node:1001");
  await page.goBack();
  await expect(card(page)).toHaveCount(0);
  expect(here(page)).toBe("/");
  await page.goForward();
  await expect(title(page, first.title)).toBeVisible();

  // Крестик свёрнутой карточки — шаг «без места»: «Назад» возвращает карточку.
  await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  expect(here(page)).toBe("/");
  await page.goBack();
  await expect(title(page, first.title)).toBeVisible();
  expect(here(page)).toBe("/?place=osm:node:1001");

  await sameDocument();
});

test("ссылка открывает место по его детальной записи, не дожидаясь ячейки карты, и показывает его на карте", async ({ page }) => {
  let release!: () => void;
  const cell = new Promise<void>(done => { release = done; });
  const far: CatalogFixture = { ...second, lat: 55.81, lon: 37.52 };
  await openMap(page, [far], "/?place=osm:way:2002", { intercept: async path => { if (path === "/api/content/map-cells/55/37") await cell; } });
  await expect(title(page, far.title)).toBeVisible();
  await expect(card(page).getByText(text.trim().slice(0, 40))).toBeVisible();
  expect(here(page)).toBe("/?place=osm:way:2002");
  // The pin from the detail stands where the place is, in the part of the map no card covers.
  const pin = (await page.locator(`[title="${far.title}"]`).boundingBox())!, sheet = (await card(page).boundingBox())!;
  expect(pin.y + pin.height).toBeLessThanOrEqual(sheet.y);
  expect(pin.x).toBeGreaterThanOrEqual(0);
  expect(pin.x + pin.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  // The cell's own pin takes its place: still one marker, the story stays open.
  release();
  await expect(page.locator('[data-region="catalog-status"]')).toHaveCount(0);
  await expect(page.locator(`[title="${far.title}"]`)).toHaveCount(1);
  await expect(title(page, far.title)).toBeVisible();
});

for (const [name, url, message] of [
  ["повреждённая", "/?place=osm:node:abc", "Ссылка на историю повреждена."],
  ["на снятую с публикации историю", "/?place=osm:node:999", "Эта история больше недоступна."],
] as const) test(`ссылка ${name} объясняет, что случилось, и убирает место из адреса`, async ({ page }) => {
  await openMap(page, [first], url);
  await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
  await expect.poll(() => here(page)).toBe("/");
  await expect(card(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Скрыть сообщение" }).click();
  await expect(page.getByText(message)).toHaveCount(0);
});

test("сбой загрузки по ссылке можно повторить", async ({ page }) => {
  let failing = true;
  await openMap(page, [first], "/?place=osm:node:1001", { intercept: async (path, route) => {
    if (path === "/api/content/map-cells/55/37") return failing ? route.fulfill({ status: 400, json: {} }).then(() => true) : false;
    if (path === "/api/content/places/osm:node:1001" && failing) { await route.fulfill({ status: 400, json: { error: { code: "BAD_REQUEST" } } }); return true; }
  } });
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть историю." })).toBeVisible();
  expect(here(page)).toBe("/?place=osm:node:1001");
  failing = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(title(page, first.title)).toBeVisible();
  await expect(page.getByText("Не удалось открыть историю.")).toHaveCount(0);
});

test("«Поделиться» есть только в развёрнутой карточке и отдаёт ссылку с превью в системное меню", async ({ page }) => {
  await page.addInitScript(() => {
    const shared: ShareData[] = [];
    Object.assign(window, { shared });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => { shared.push(data); } });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  });
  await openMap(page, [first]);
  await openPin(page, first.title);
  const share = page.getByRole("button", { name: "Поделиться", exact: true });
  await expect(share).toHaveCount(0);
  await expand(page);
  await share.click();
  const origin = new URL(page.url()).origin;
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared))
    .toEqual([{ title: first.title, text: `${first.title} — история в «Отголоске»`, url: `${origin}/place/node/1001` }]);
  // The system sheet took the link: nothing else to show.
  await expect(page.getByText("Ссылка скопирована.")).toHaveCount(0);
});

for (const [name, clipboard, outcome] of [
  ["копирует ссылку", "works", "copied"],
  ["показывает ссылку для ручного копирования", "refuses", "manual"],
] as const) test(`без системного меню «Поделиться» ${name}`, async ({ page }) => {
  await page.addInitScript(refuse => {
    const copied: string[] = [];
    Object.assign(window, { copied });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      if (refuse) throw new DOMException("Clipboard blocked", "NotAllowedError");
      copied.push(value);
    } } });
  }, clipboard === "refuses");
  await openMap(page, [first]);
  await openPin(page, first.title);
  await expand(page);
  // Read to the end: the result appears below the button, where the pinned player is.
  await card(page).evaluate(sheet => { sheet.scrollTop = sheet.scrollHeight; });
  await page.getByRole("button", { name: "Поделиться", exact: true }).click();
  const link = `${new URL(page.url()).origin}/place/node/1001`;
  const result = outcome === "copied" ? card(page).getByRole("status").filter({ hasText: "Ссылка скопирована." }) : card(page).getByLabel("Скопируйте ссылку");
  await expect(result).toBeVisible();
  if (outcome === "copied") expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([link]);
  else {
    await expect(result).toHaveValue(link);
    await expect(result).toBeFocused();
  }
  // The result is shown, not hidden under the player.
  await expect.poll(() => result.evaluate(element => {
    const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (element.contains(hit) || hit.contains(element));
  })).toBe(true);
});

test("конструктор прогулки от места возвращает к нему: и «Назад», и крестик", async ({ page }) => {
  await openMap(page, [first]);
  await openPin(page, first.title);
  await expand(page);
  await page.getByRole("link", { name: "Создать прогулку отсюда" }).click();
  await expect(page.locator('[data-sheet="creation"]')).toBeVisible();
  expect(here(page)).toMatch(/^\/\?walk=create/);

  // «Назад» — к развёрнутой истории, с её адресом.
  await page.goBack();
  await expect(page.locator('[data-sheet="creation"]')).toHaveCount(0);
  await expect(page.locator('[data-sheet="story"][data-expanded]')).toBeAttached();
  expect(here(page)).toBe("/?place=osm:node:1001");

  // Крестик конструктора тоже возвращает к месту и его адресу.
  await page.waitForFunction(() => !document.documentElement.matches(":active-view-transition"));
  await page.getByRole("link", { name: "Создать прогулку отсюда" }).click();
  await expect(page.locator('[data-sheet="creation"]')).toBeVisible();
  await page.getByRole("button", { name: "Закрыть создание прогулки" }).click();
  await expect(page.locator('[data-sheet="creation"]')).toHaveCount(0);
  await expect(title(page, first.title)).toBeVisible();
  expect(here(page)).toBe("/?place=osm:node:1001");
});
