import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { user: null, walks: [], nextCursor: null, items: [] } }));
});

test("знак одинакового размера на карте и странице входа", async ({ page }) => {
  const sizes: string[] = [];
  for (const path of ["/", "/login"]) {
    await page.goto(path);
    sizes.push(await page.locator(".brand-mark").first().evaluate(el => getComputedStyle(el).fontSize));
  }
  expect(sizes).toEqual(["28px", "28px"]);
});

test("история загружает следующую страницу аккаунтных прогулок", async ({ page }, info) => {
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
  await page.route("**/api/me/walks*", route => route.fulfill({ json: { walks: [{ id: route.request().url().includes("cursor=") ? "two" : "one", title: route.request().url().includes("cursor=") ? "Вторая прогулка" : "Первая прогулка", revision: 0 }], nextCursor: route.request().url().includes("cursor=") ? null : "next" } }));
  await page.goto("/history");
  await expect(page.getByText("Первая прогулка", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(page.getByText("Вторая прогулка", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("history-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath("history-desktop.png"), fullPage: true });
});

test("сбой сессии не выглядит как отсутствие прогулок", async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({ status: 503, json: {} }));
  await page.goto("/history");
  await expect(page.locator("main").getByRole("alert")).toContainText("вход");
});

test("создаёт A→Б на карте и восстанавливает его из истории", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } };
  const destination = { address: "Москва, Арбат, 20", location: { lat: 55.752, lon: 37.6 } };
  await page.route("**/api/story-place?*", route => route.fulfill({ json: route.request().url().includes("20") ? destination : start }));
  await page.route("**/api/walk-plan", async route => {
    const request = route.request().postDataJSON();
    expect(request.destination).toEqual(destination);
    await route.fulfill({ json: { stops: [], geometry: [start.location, destination.location], walkingMinutes: 4, distanceM: 220, attribution: "OSM" } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Прогулка", exact: true }).click();
  await page.getByLabel("Адрес начала").fill(start.address);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать эту точку" }).click();
  await page.getByLabel("Адрес финиша").fill(destination.address);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать эту точку" }).click();
  await page.getByRole("button", { name: "Построить прогулку" }).click();
  await expect(page.getByRole("heading", { name: "Ваш маршрут" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть создание прогулки" }).click();
  await page.getByRole("link", { name: "История", exact: true }).click();
  await page.getByRole("link", { name: "Редактировать" }).click();
  await expect(page.getByRole("heading", { name: "Ваш маршрут" })).toBeVisible();
  await expect(page.locator(".creation-panel")).toContainText(destination.address);
  await page.getByRole("link", { name: "Открыть прогулку", exact: true }).click();
  await expect(page.locator(".creation-panel")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("дом передаёт старт, возврат включён по умолчанию, Back закрывает панель", async ({ page }) => {
  await page.route("**/api/content/places?*", route => route.fulfill({ json: { places: [{ id: "test-house", name: "Дом для прогулки", address: "Москва, Дербеневская, 1", location: { lat: 55.7249, lon: 37.6507 }, story: null, audio: null }] } }));
  await page.goto("/");
  await page.locator('[title="Дом для прогулки"]').click();
  await page.getByRole("link", { name: "Создать прогулку отсюда" }).click();
  await expect(page.locator(".creation-endpoints")).toContainText("Москва, Дербеневская, 1");
  await page.getByRole("button", { name: "По времени", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Вернуться к началу" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Вернуться к началу" }).uncheck();
  await page.goBack();
  await expect(page.locator(".creation-panel")).toHaveCount(0);
  await page.goForward();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Вернуться к началу" })).not.toBeChecked();
});

test("восстанавливает исследование после перезагрузки без повторного заказа", async ({ page }) => {
  const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } };
  const request = { start, mode: "loop", minutes: 30 };
  const id = "11111111-1111-4111-8111-111111111111";
  const draft = { version: 1, title: "Исследование", start, mode: "loop", minutes: 30, stops: [], route: null, jobs: [], submitting: null, research: { request, id, stops: [], recoveryToken: id } };
  await page.addInitScript(value => { if (!localStorage.getItem("otgolosok:walk:v1")) localStorage.setItem("otgolosok:walk:v1", JSON.stringify(value)); }, draft);
  let posts = 0;
  await page.route("**/api/walk-research-jobs/**", route => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: { id, request, stage: "queued", revision: 0, phase: "discovery", progress: { checked: 0, total: 0, accepted: 0 }, route: null, stories: [], error: null, canRetry: false } });
  });
  await page.goto("/?walk=create&resume=1");
  await expect(page.getByText("Ждём своей очереди", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ждём своей очереди", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
});

test("профиль сохраняет имя даже при отказе избранного", async ({ page }, info) => {
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
  await page.route("**/api/me/requests*", route => route.fulfill({ json: { requests: [] } }));
  await page.route("**/api/me/favorites*", route => route.fulfill({ status: 503, json: { error: { message: "Избранное временно недоступно" } } }));
  await page.route("**/api/me", route => route.fulfill({ json: { user: { id: "test", name: route.request().postDataJSON().name, email: "test@example.test" } } }));
  await page.goto("/account");
  await page.getByLabel("Ваше имя").fill("Анна Новая");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByRole("heading", { name: "Анна Новая" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Имя сохранено");
  await page.screenshot({ path: info.outputPath("profile-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath("profile-desktop.png"), fullPage: true });
});

test("локальный выход очищает приватный кеш даже при отказе сервера", async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
  await page.route("**/api/me/requests*", route => route.fulfill({ json: { requests: [] } }));
  await page.route("**/api/me/favorites*", route => route.fulfill({ json: { favorites: [] } }));
  await page.route("**/api/auth/sign-out", route => route.fulfill({ status: 503, json: {} }));
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Анна", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const cache = await caches.open("walk-packs-v1");
    await cache.put("/__offline/walks/test/private/pointer.json", new Response("private"));
    await cache.put("/__offline/walks/guest/public/pointer.json", new Response("public"));
  });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить выход", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(async () => {
    const cache = await caches.open("walk-packs-v1");
    return { private: Boolean(await cache.match("/__offline/walks/test/private/pointer.json")), public: Boolean(await cache.match("/__offline/walks/guest/public/pointer.json")), signedOut: Boolean(localStorage.getItem("otgolosok:auth:offline-logout")) };
  })).toEqual({ private: false, public: true, signedOut: true });
});

test("сохранение в аккаунт сохраняет последующие правки черновика после перезагрузки", async ({ page }) => {
  const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } };
  const destination = { address: "Москва, Арбат, 20", location: { lat: 55.752, lon: 37.6 } };
  const draft = { version: 1, title: "Маршрут в аккаунт", start, destination, mode: "open", minutes: 30, stops: [], route: { stops: [], geometry: [start.location, destination.location], walkingMinutes: 4, distanceM: 220, attribution: "OSM" }, jobs: [], submitting: null };
  await page.addInitScript(value => { if (!localStorage.getItem("otgolosok:walk:v1")) localStorage.setItem("otgolosok:walk:v1", JSON.stringify(value)); }, draft);
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { id: "test", name: "Анна", email: "test@example.test" } } }));
  let walk: Record<string, unknown> = {};
  await page.route("**/api/me/walks**", async route => {
    if (route.request().method() === "POST") walk = { ...route.request().postDataJSON(), id: "11111111-1111-4111-8111-111111111111", revision: 1 };
    await route.fulfill({ json: { walk } });
  });
  await page.goto("/?walk=create&resume=1");
  await page.getByRole("button", { name: "Сохранить в аккаунте" }).click();
  await expect(page.getByRole("button", { name: "Обновить в аккаунте" })).toBeVisible();
  await page.getByText("Изменить название и маршрут", { exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Несохранённая правка");
  await page.reload();
  await page.getByText("Изменить название и маршрут", { exact: true }).click();
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue("Несохранённая правка");
  await expect(page.getByRole("button", { name: "Обновить в аккаунте" })).toBeVisible();
});

test("Escape закрывает панель и возвращает фокус в навигацию", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("link", { name: "Прогулка", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Куда пойдём?" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".creation-panel")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

for (const [width, height] of [[360, 800], [390, 844], [568, 400], [844, 390], [699, 800], [700, 800], [768, 1024], [1440, 900]]) {
  test(`панель и навигация не перекрываются ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?walk=create");
    await expect(page.getByLabel("Адрес начала")).toBeVisible();
    const panel = await page.locator(".creation-panel").boundingBox();
    const nav = await page.getByRole("navigation", { name: "Основная навигация" }).boundingBox();
    expect(Math.abs(panel!.x + panel!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    const surface = await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);
    for (const selector of [".creation-panel", ".creation-footer"]) {
      expect(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)).toBe(surface);
    }
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(nav!.y);
    for (const item of await page.getByRole("navigation").locator("a,button").all()) {
      const box = await item.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    }
    await expect(page.locator(".around-bottom")).toBeHidden();
    await page.screenshot({ path: info.outputPath("creation.png") });
  });
}
