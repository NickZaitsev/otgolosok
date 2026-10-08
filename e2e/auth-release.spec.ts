import { test, expect } from "./support/test";

for (const mode of ["sign-in", "sign-up"] as const) {
  test(`авторизация ${mode}: форма отправляется и возвращает пользователя на карту`, async ({ page }) => {
    let authenticated = false;
    const user = { id: "release-test-user", name: "Тест", email: "release@example.test" };
    await page.route("**/api/auth/session", route => route.fulfill({ json: { user: authenticated ? user : null } }));
    await page.route(`**/api/auth/${mode}/email`, async route => {
      expect(route.request().postDataJSON()).toEqual({
        ...(mode === "sign-up" ? { name: user.name } : {}),
        email: user.email,
        password: "test-password-123",
      });
      authenticated = true;
      await route.fulfill({ json: { user } });
    });
    await page.goto("/login?returnTo=%2F");
    if (mode === "sign-up") {
      await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
      await page.getByLabel("Имя", { exact: true }).fill(user.name);
    }
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Пароль", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: mode === "sign-up" ? "Создать аккаунт" : "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("otgolosok:account:last-user"))).toBe(user.id);
  });
}

test("ошибка регистрации сохраняет форму и позволяет повторить попытку", async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: null } }));
  await page.route("**/api/auth/sign-up/email", route => route.fulfill({ status: 422, json: { message: "Email already exists" } }));
  await page.goto("/login");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Тест");
  await page.getByLabel("Email", { exact: true }).fill("release@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Не удалось создать аккаунт. Возможно, этот email уже используется.");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("release@example.test");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("test-password-123");
  await expect(page.getByRole("button", { name: "Создать аккаунт", exact: true })).toBeEnabled();
});
