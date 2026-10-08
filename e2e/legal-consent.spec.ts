import { expect, test } from "./support/test";
import { LEGAL_READY } from "../legal/publication.mjs";

test.use({ essentialCookies: false });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({json: {user: null}}));
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

test("документы доступны без JavaScript и не отправляют tracking-пиксель", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const tracking: string[] = [];
  page.on("request", request => {if (/mc\.yandex\./.test(request.url())) tracking.push(request.url());});
  try {
    await page.goto("/legal/privacy");
    await expect(page.getByRole("heading", {name: "Политика обработки персональных данных", exact: true})).toBeVisible();
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
