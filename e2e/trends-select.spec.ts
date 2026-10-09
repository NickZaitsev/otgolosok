import { expect, test } from "./support/test";

test("фильтры трендов сохраняют отступ стрелки и работают после выбора", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/trends");

  const start = page.getByLabel("Ближайшее метро к старту");
  const duration = page.getByLabel("Продолжительность");
  await expect(start).toBeVisible();
  await expect(start).toHaveCSS("appearance", "none");

  const spacing = await start.evaluate(select => {
    const style = getComputedStyle(select);
    const arrow = getComputedStyle(select.parentElement!, "::after");
    return { textSpace: parseFloat(style.paddingInlineEnd), edgeSpace: parseFloat(arrow.marginInlineEnd), arrowWidth: parseFloat(arrow.width) };
  });
  expect(spacing.edgeSpace).toBeGreaterThanOrEqual(12);
  expect(spacing.textSpace).toBeGreaterThan(spacing.edgeSpace + spacing.arrowWidth);

  await duration.selectOption("up-to-30");
  await expect(duration).toHaveValue("up-to-30");
});
