import { expect, test } from "./support/test";
import { LEGAL_READY, TERMS_VERSION } from "../legal/publication.mjs";
import { COOKIE_CONSENT_KEY } from "../src/features/legal/cookie-consent";

test.use({ essentialCookies: false });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({json: {user: null}}));
  await page.route("**/api/auth/providers", route => route.fulfill({json: {telegram: false}}));
});

test("регистрация через Telegram передаёт условия после явного подтверждения", async ({ page }) => {
  await page.route("**/api/auth/providers", route => route.fulfill({json: {telegram: true}}));
  let accepted: Record<string, unknown> | null = null;
  await page.route("**/api/auth/sign-in/social", async route => {
    accepted = route.request().postDataJSON();
    await route.fulfill({json: {url: "https://oauth.telegram.org/auth?test=legal"}});
  });
  await page.route("https://oauth.telegram.org/auth?test=legal", route => route.fulfill({contentType: "text/html", body: "<h1>Telegram</h1>"}));
  await page.goto("/login?returnTo=%2Fwalk%3Fid%3D42");
  await page.getByRole("button", {name: "Только необходимые"}).click();
  await page.getByRole("button", {name: "Нет аккаунта? Зарегистрироваться"}).click();
  const telegram = page.getByRole("button", {name: "Продолжить через Telegram"});
  await expect(telegram).toBeDisabled();
  await page.getByRole("checkbox", {name: "Я принимаю условия использования."}).check();
  await expect(telegram).toBeEnabled();
  await telegram.click();
  await expect(page).toHaveURL("https://oauth.telegram.org/auth?test=legal");
  expect(accepted).toMatchObject({provider: "telegram", termsAccepted: true, termsVersion: TERMS_VERSION, callbackURL: "/walk?id=42"});
});

test("отзыв останавливает аналитику локально при ошибке сервера и допускает повтор", async ({ page }) => {
  const receipt = "11111111-1111-4111-8111-111111111111." + "a".repeat(43);
  let revocations = 0;
  await page.route("**/api/legal/analytics-choice", async route => {
    const body = route.request().postDataJSON();
    if (body.analytics) return route.fulfill({json: {receipt, decidedAt: Date.now()}});
    expect(body.receipt).toBe(receipt);
    revocations++;
    await route.fulfill(revocations === 1 ? {status: 403, json: {error: "Отказ"}} : {json: {receipt: null}});
  });
  await page.goto("/login");
  const notice = page.getByRole("complementary", {name: "Cookie и приватность"});
  await notice.getByRole("button", {name: "Разрешить аналитику"}).click();
  await expect(notice).toBeHidden();
  await page.getByRole("button", {name: "Настройки cookie"}).click();
  await notice.getByRole("button", {name: "Только необходимые"}).click();
  await expect(notice.getByRole("alert")).toHaveText("Аналитика выключена на этом устройстве. Не удалось подтвердить отзыв на сервере. Повторите выбор.");
  const choice = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), COOKIE_CONSENT_KEY);
  await expect.poll(choice).toMatchObject({analytics: false, receipt});
  await notice.getByRole("button", {name: "Только необходимые"}).click();
  await expect(notice).toBeHidden();
  await expect.poll(choice).toMatchObject({analytics: false, receipt: null});
  expect(revocations).toBe(2);
});

test("отказ сохраняется после перезагрузки, настройки доступны снова", async ({ page }) => {
  const tracking: string[] = [];
  page.on("request", request => { if (/mc\.yandex\./.test(request.url())) tracking.push(request.url()); });
  await page.goto("/login");
  const notice = page.getByRole("complementary", {name: "Cookie и приватность"});
  await expect(notice).toBeVisible();
  await notice.getByRole("button", {name: "Только необходимые"}).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", {name: "Вход", exact: true})).toBeVisible();
  await expect(notice).toBeHidden();
  await page.getByRole("button", {name: "Настройки cookie"}).click();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", {name: "Закрыть", exact: true}).click();
  await expect(notice).toBeHidden();
  expect(tracking).toEqual([]);
});

test("условия открываются отдельно, подтверждение по умолчанию выключено", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", {name: "Только необходимые"}).click();
  await page.getByRole("button", {name: "Нет аккаунта? Зарегистрироваться"}).click();
  const consent = page.getByRole("checkbox", {name: "Я принимаю условия использования."});
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("button", {name: "Создать аккаунт", exact: true})).toBeDisabled();
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", {name: "условия использования", exact: true}).click();
  const terms = await popup;
  await expect(terms.getByRole("heading", {name: "Условия использования", exact: true})).toBeVisible();
  await terms.close();
  await expect(page.getByRole("heading", {name: "Регистрация", exact: true})).toBeVisible();
  await consent.check();
  if (!LEGAL_READY) await expect(page.getByRole("button", {name: "Создать аккаунт", exact: true})).toBeDisabled();
  else await expect(page.getByRole("button", {name: "Создать аккаунт", exact: true})).toBeEnabled();
});

for (const [path, title, refusal] of [
  ["/en/login", "Cookies and privacy", "Essential only"],
  ["/zh/login", "Cookie 与隐私", "仅使用必要 Cookie"],
] as const) {
  test(`cookie-уведомление локализовано: ${path}`, async ({ page }) => {
    await page.goto(path);
    const notice = page.getByRole("complementary", {name: title});
    await expect(notice).toBeVisible();
    await notice.getByRole("button", {name: refusal}).click();
    await expect(notice).toBeHidden();
  });
}

test("без JavaScript документы читаются до конца без перекрывающего cookie-баннера и tracking-пикселя", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: {width: 390, height: 844} });
  const page = await context.newPage();
  const tracking: string[] = [];
  page.on("request", request => {if (/mc\.yandex\./.test(request.url())) tracking.push(request.url());});
  try {
    for (const [name, title] of [["privacy", "Политика обработки персональных данных"], ["cookies", "Использование cookie и хранилища устройства"]]) {
      await page.goto(`/legal/${name}`);
      await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
      await expect(page.getByRole("complementary", {name: "Cookie и приватность"})).toHaveCount(0);
      const footer = page.getByRole("navigation", {name: "Правовая информация"});
      await footer.scrollIntoViewIfNeeded();
      const visibleEnd = await page.locator("article").evaluate(article => {
        const lastParagraph = article.querySelector("p:last-of-type")!;
        const footer = article.querySelector("nav")!;
        return [lastParagraph, footer].every(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight && [bounds.top + 2, bounds.bottom - 2].every(y => {
            const foreground = document.elementFromPoint(bounds.left + bounds.width / 2, y);
            return foreground !== null && (element.contains(foreground) || foreground.contains(element));
          });
        });
      });
      expect(visibleEnd).toBe(true);
    }
    expect(tracking).toEqual([]);
  } finally {await context.close();}
});

test("уведомление помещается на узком экране и коротком горизонтальном", async ({ page }) => {
  for (const viewport of [{width: 320, height: 640}, {width: 844, height: 390}]) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    const notice = page.getByRole("complementary", {name: "Cookie и приватность"});
    await expect(notice).toBeVisible();
    const bounds = await notice.evaluate(element => element.parentElement!.getBoundingClientRect().toJSON());
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("button", {name: "Только необходимые"})).toBeVisible();
  }
});
