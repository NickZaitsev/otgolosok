import { expect, test } from "./support/test";

test("медиа в тестах играет без звука", async ({ page }) => {
  // An app page, not about:blank: WebKit does not run init scripts there, and the fixture guards the app.
  await page.goto("/login");
  const muted = await page.evaluate(() => {
    const audio = new Audio();
    audio.play().catch(() => undefined);
    return audio.muted;
  });
  expect(muted).toBe(true);
});
