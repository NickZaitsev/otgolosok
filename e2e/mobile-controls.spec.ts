import { expect, test, type Locator, type Page } from "./support/test";
import { draftToWalkDocument } from "../src/features/walks/adapters";

// Основное действие одной высоты и формы на всех экранах и размерах, поля ввода не крупнее кнопок,
// а шрифт в поле не меньше 16 px: на меньшем Safari на iPhone сам приближает страницу при фокусе.
const PRIMARY = { height: 48, font: 16, weight: 700, pill: true };
const FIELD = { height: 48, minFont: 16, weight: 400 };

const shape = (element: Locator) => element.evaluate(el => {
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  return { height: Math.round(box.height), font: parseFloat(style.fontSize), weight: Number(style.fontWeight), radius: parseFloat(style.borderTopLeftRadius) };
});

async function expectPrimary(button: Locator) {
  await expect(button).toBeVisible();
  const { height, font, weight, radius } = await shape(button);
  expect({ height, font, weight, pill: radius >= height / 2 }).toEqual(PRIMARY);
}

const walkId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
async function openWalk(page: Page) {
  const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } };
  const stops = [{ address: "Москва, Арбат, 3", location: { lat: 55.751, lon: 37.601 } }];
  const document = draftToWalkDocument({
    version: 1, title: "Арбат", start, destination: stops[0], mode: "open", minutes: 30, stops,
    route: { stops, geometry: [start.location, stops[0].location], distanceM: 200, walkingMinutes: 3, attribution: "OSM" },
    jobs: [], submitting: null
  }, walkId);
  await page.addInitScript(({ id, document }) => {
    localStorage.setItem("otgolosok:walks:v2", JSON.stringify({ version: 2, legacyId: null, items: { [id]: { document, revision: 0 } } }));
  }, { id: walkId, document });
  await page.route("**/api/food/**", route => route.fulfill({ status: 503, json: { error: "FOOD_INDEX_UNAVAILABLE" } }));
  await page.goto(`/walk?local=${walkId}`);
}

// iPhone 16, iPhone SE, телефон боком.
const VIEWPORTS = [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 568, height: 320 }];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.route("**/api/**", route => route.fulfill({ json: { user: null, walks: [], items: [], version: 1, cellSize: 1, cells: [] } }));
});

const primaries: [string, (page: Page) => Promise<Locator>][] = [
  ["карта «Рядом»", async page => { await page.goto("/"); return page.getByRole("button", { name: "Включить геолокацию" }); }],
  ["вход", async page => { await page.goto("/login"); return page.getByRole("button", { name: "Войти", exact: true }); }],
  ["прогулка до старта", async page => { await openWalk(page); return page.getByRole("button", { name: "Начать прогулку", exact: true }); }],
  ["идущая прогулка", async page => {
    await openWalk(page);
    await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
    return page.locator(".walk-session-primary");
  }],
  ["создание прогулки", async page => {
    const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } };
    const destination = { address: "Москва, Арбат, 20", location: { lat: 55.752, lon: 37.6 } };
    await page.route("**/api/story-place?*", route => route.fulfill({ json: route.request().url().includes("20") ? destination : start }));
    await page.goto("/?walk=create");
    for (const [name, place] of [["Откуда", start], ["Куда", destination]] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("button", { name: "Ввести адрес", exact: true }).click();
      await page.getByRole("textbox", { name, exact: true }).fill(place.address);
      await page.getByRole("textbox", { name, exact: true }).press("Enter");
    }
    return page.getByRole("button", { name: "Построить прогулку" });
  }],
  ["подтверждение остановки", async page => {
    await openWalk(page);
    await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
    await page.getByRole("button", { name: "Прервать прогулку" }).click();
    return page.getByRole("dialog", { name: "Прервать прогулку?" }).getByRole("button", { name: "Прервать", exact: true });
  }],
];

for (const viewport of VIEWPORTS) {
  for (const [screen, open] of primaries) {
    test(`основное действие 48 px, капсула, 16 px — ${screen}, ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await expectPrimary(await open(page));
    });
  }
}

for (const viewport of VIEWPORTS) {
  test(`поля входа 48 px, текст обычный, подпись меньше текста поля, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    for (const name of ["Email", "Пароль"]) {
      const field = page.getByLabel(name, { exact: true });
      await field.fill("проверка");
      const { height, font, weight } = await shape(field);
      expect({ height, font: font >= FIELD.minFont, weight }).toEqual({ height: FIELD.height, font: true, weight: FIELD.weight });
      const label = await field.evaluate(el => parseFloat(getComputedStyle(el.closest("label")!).fontSize));
      expect(label).toBeLessThan(font);
    }
  });

  test(`адрес в создании прогулки набирается шрифтом не меньше 16 px, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?walk=create");
    await page.getByRole("button", { name: /^Откуда/ }).click();
    await page.getByRole("button", { name: "Ввести адрес", exact: true }).click();
    const input = page.getByPlaceholder("Улица и номер дома");
    await expect(input).toBeFocused();
    const { font, weight } = await shape(input);
    expect(font).toBeGreaterThanOrEqual(FIELD.minFont);
    expect(weight).toBe(FIELD.weight);
  });

  test(`поля настроек прогулки не мельче 16 px, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWalk(page);
    await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
    await page.getByRole("button", { name: "Настройки" }).click();
    const selects = page.locator(".walk-session-settings select");
    await expect(selects.first()).toBeVisible();
    for (const select of await selects.all()) {
      const { height, font, weight } = await shape(select);
      expect({ height, font: font >= FIELD.minFont, weight }).toEqual({ height: FIELD.height, font: true, weight: FIELD.weight });
    }
  });

  test(`общее поле .ui-field ровно 48 px, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
    await page.route("**/api/me/**", route => route.fulfill({ json: { requests: [], favorites: [], walks: [] } }));
    await page.goto("/account");
    await page.getByRole("button", { name: /Изменить|Редактировать/ }).first().click();
    const field = page.locator(".ui-field input").first();
    await expect(field).toBeVisible();
    const { height, font, weight } = await shape(field);
    expect({ height, font: font >= FIELD.minFont, weight }).toEqual({ height: FIELD.height, font: true, weight: FIELD.weight });
    await expectPrimary(page.getByRole("button", { name: "Сохранить изменения" }));
  });
}

// Футер прилеплен к низу панели: элемент, до которого дошли клавишей Tab, не должен оказаться под ним.
test("на 568×320 фокус в прокручиваемой панели не прячется под футером", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await openWalk(page);
  await page.getByRole("button", { name: "Начать прогулку", exact: true }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.locator(".walk-session-panel").evaluate(el => { el.scrollTop = 0; });
  await page.locator(".walk-session-panel :is(button, a, select)").first().focus();
  const covered: string[] = [];
  for (let step = 0; step < 20; step += 1) {
    const state = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null;
      const panel = document.querySelector(".walk-session-panel");
      if (!focused || !panel?.contains(focused)) return null;
      const box = focused.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const label = (focused.getAttribute("aria-label") || focused.textContent || focused.tagName).trim().slice(0, 30);
      return { label, visible: Boolean(hit && (focused === hit || focused.contains(hit))) };
    });
    if (!state) break;
    if (!state.visible) covered.push(state.label);
    await page.keyboard.press("Tab");
  }
  expect(covered).toEqual([]);
});

test("подпись кнопки в две строки на 320 px не вылезает за кнопку и экран", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
  await page.route("**/api/me/**", route => route.fulfill({ json: { requests: [], favorites: [], walks: [] } }));
  await page.goto("/account");
  const buttons = page.locator(".ui-button:visible");
  await expect(buttons.first()).toBeVisible();
  const broken = await buttons.evaluateAll(list => list.filter(el => {
    const box = el.getBoundingClientRect();
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || box.left < 0 || box.right > innerWidth;
  }).map(el => el.textContent?.trim()));
  expect(broken).toEqual([]);
  const tall = await buttons.evaluateAll(list => list.some(el => el.getBoundingClientRect().height > 48));
  expect(tall, "на 320 px хотя бы одна подпись переносится — иначе тест ничего не проверяет").toBe(true);
});

// Админка — рабочий инструмент, но тот же язык: основное действие 48 px, остальные кнопки — капсулы
// не меньше зоны нажатия 44 px, поля как везде.
for (const viewport of [VIEWPORTS[0], { width: 1440, height: 900 }]) {
  test(`кнопки и поля админки по дизайн-системе, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "editor", role: "editor", name: "Редактор", email: "editor@example.test" }, csrfToken: "test-csrf" } });
      if (path === "/api/story-admin/jobs") return route.fulfill({ json: { jobs: [], hasMore: false } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/admin?section=addresses");
    await expectPrimary(page.getByRole("button", { name: "Найти", exact: true }));
    for (const name of ["Обновить", "Выйти"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const { height, font, weight, radius } = await shape(button);
      expect({ height: height >= 44, font, weight, pill: radius >= height / 2 }).toEqual({ height: true, font: 16, weight: 700, pill: true });
    }
    // Наведение не должно снимать заливку основного действия: белый текст на светлом фоне не читается.
    const find = page.getByRole("button", { name: "Найти", exact: true });
    await find.hover();
    const paint = await find.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(paint).toEqual({ background: "rgb(32, 62, 56)", color: "rgb(255, 255, 255)" });
    const fields = page.locator(".admin-desk :is(input:not([type=checkbox]), select)");
    await expect(fields.first()).toBeVisible();
    for (const field of await fields.all()) {
      const { height, font, weight } = await shape(field);
      expect({ height, font: font >= FIELD.minFont, weight }).toEqual({ height: FIELD.height, font: true, weight: FIELD.weight });
    }
  });
}

// Ссылка «Войти» видна, когда сессию проверить не удалось: тогда админка не уводит на /login сама.
test("вход в админку при сбое сессии — основное действие", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: {} }));
  await page.goto("/admin");
  await expectPrimary(page.getByRole("link", { name: "Войти", exact: true }));
});
