import { test, expect } from "./support/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { user: null, walks: [], nextCursor: null, items: [], version: 1, cellSize: 1, cells: [] } }));
});

test("значок обновляется после выдачи и отзыва разрешения", async ({ page, context }) => {
  await context.setGeolocation({ latitude: 55.7249, longitude: 37.6507, accuracy: 20 });
  await page.goto("/");
  await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
  const control = page.getByRole("button", { name: "Моё местоположение", exact: true });
  await control.click();
  await expect(control).toHaveAttribute("data-location-state", "denied");
  await context.grantPermissions(["geolocation"]);
  await expect(control).toHaveAttribute("data-location-state", "idle");
  await expect(page.getByText("Нет доступа к геолокации. Можно разрешить его в настройках или выбрать место на карте.")).toHaveCount(0);
  await control.click();
  await expect(control).toHaveAttribute("data-location-state", "ready");
  const session = await context.newCDPSession(page);
  // clearPermissions возвращает prompt; CDP позволяет эмулировать явный отзыв доступа.
  const { targetInfo } = await session.send("Target.getTargetInfo");
  await session.send("Browser.setPermission", { permission: { name: "geolocation" }, setting: "denied", origin: new URL(page.url()).origin, browserContextId: targetInfo.browserContextId });
  await expect(control).toHaveAttribute("data-location-state", "denied");
  await expect(control).toHaveAccessibleDescription("Нет доступа к геолокации.");
  await page.reload();
  await expect(control).toHaveAttribute("data-location-state", "denied");
});

for (const [code, message] of [[2, "Устройство не смогло определить положение."], [3, "Не удалось вовремя определить положение."]] as const) {
  test(`ошибка геолокации ${code} отличается от запрета и допускает повтор`, async ({ page }) => {
    await page.addInitScript(errorCode => {
      Object.defineProperty(navigator, "permissions", { value: errorCode === 2 ? { query: () => Promise.reject(new TypeError("unsupported")) } : undefined });
      const fail = (_success: PositionCallback, error?: PositionErrorCallback | null) => queueMicrotask(() => error?.({ code: errorCode } as GeolocationPositionError));
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: fail, watchPosition: (...args: Parameters<typeof fail>) => { fail(...args); return 1; }, clearWatch: () => {} } });
    }, code);
    await page.goto("/");
    await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
    const control = page.getByRole("button", { name: "Моё местоположение", exact: true });
    await control.click();
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(control).toHaveAttribute("data-location-state", "weak");
    await expect(control).toHaveAccessibleDescription("Не удаётся определить точное местоположение.");
    await expect(control).toHaveCSS("color", "rgb(115, 83, 19)");
    await expect(control).toBeEnabled();
  });
}

test("поиск отключает повторное нажатие и уточняет слабую позицию", async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", { value: undefined });
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: () => {},
      watchPosition: (success: PositionCallback) => {
        window.addEventListener("test-position", event => success({ coords: { latitude: 55.7249, longitude: 37.6507, accuracy: (event as CustomEvent<number>).detail }, timestamp: Date.now() } as GeolocationPosition));
        return 1;
      },
      clearWatch: () => {},
    } });
  });
  await page.goto("/");
  await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
  const control = page.getByRole("button", { name: "Моё местоположение", exact: true });
  await control.click();
  await expect(control).toBeDisabled();
  await expect(control).toHaveAccessibleDescription("Определяем положение…");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-position", { detail: 800 })));
  await expect(control).toBeEnabled({ timeout: 10_000 });
  await expect(control).toHaveAccessibleDescription("Низкая точность геолокации: около 800 м.");
  await page.screenshot({ path: info.outputPath("geolocation-weak.png") });
  await control.click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-position", { detail: 20 })));
  await expect(control).toHaveAttribute("data-location-state", "ready");
  await expect(control).toHaveAccessibleDescription("Местоположение определено.");
  await expect(control).toHaveCSS("color", "rgb(32, 62, 56)");
  await page.screenshot({ path: info.outputPath("geolocation-ready.png") });
});

test("браузер без геолокации показывает перечёркнутый значок", async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", { value: undefined }));
  await page.goto("/");
  await expect(page.getByText("Загружаем карту…")).toHaveCount(0);
  const control = page.getByRole("button", { name: "Моё местоположение", exact: true });
  await control.click();
  await expect(control).toHaveAttribute("data-location-state", "unavailable");
  await expect(control).toHaveAccessibleDescription("Геолокация недоступна в этом браузере.");
  await expect(control).toHaveCSS("color", "rgb(152, 46, 36)");
  await page.screenshot({ path: info.outputPath("geolocation-unavailable.png") });
});
