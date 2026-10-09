import { expect, test } from "./support/test";

const lines = { paveletskaya: [{ id: "2", name: "Замоскворецкая", color: "#4fb04f" }, { id: "5", name: "Кольцевая", color: "#915133" }] };
const walk = (id: string, title: string, start: string) => ({ kind: "catalog", id, title, walkingMinutes: 30, distanceM: 2000, stopCount: 4,
  rating: { average: null, count: 0 }, rank: 1, preview: [[8, 92], [92, 8]], mapPreview: null,
  startMetro: { name: start, distanceM: 100, lines: start === "Павелецкая" ? lines.paveletskaya : [] }, endMetro: null });

test("фильтры трендов сохраняют отступ стрелки и работают после выбора", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/trends");

  const duration = page.getByLabel("Продолжительность");
  await expect(duration).toBeVisible();
  await expect(duration).toHaveCSS("appearance", "none");

  const spacing = await duration.evaluate(select => {
    const style = getComputedStyle(select);
    const arrow = getComputedStyle(select.parentElement!, "::after");
    return { textSpace: parseFloat(style.paddingInlineEnd), edgeSpace: parseFloat(arrow.marginInlineEnd), arrowWidth: parseFloat(arrow.width) };
  });
  expect(spacing.edgeSpace).toBeGreaterThanOrEqual(12);
  expect(spacing.textSpace).toBeGreaterThan(spacing.edgeSpace + spacing.arrowWidth);

  await duration.selectOption("up-to-30");
  await expect(duration).toHaveValue("up-to-30");
});

test("станцию метро находят поиском, список помещается на узком экране и перекрывает карточки", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route("**/api/top-walks**", route => {
    const start = new URL(route.request().url()).searchParams.get("start");
    const walks = [walk("route-a", "У Павелецкой", "Павелецкая"), walk("route-b", "У Арбатской", "Арбатская")].filter(item => !start || item.startMetro.name === start);
    return route.fulfill({ json: { walks, total: walks.length, nextOffset: null, filters: { starts: ["Арбатская", "Павелецкая"], ends: [],
      stations: [{ name: "Арбатская", lines: [] }, { name: "Павелецкая", lines: lines.paveletskaya }] } } });
  });
  await page.goto("/trends");

  const trigger = page.getByRole("button", { name: "Ближайшее метро к старту Любая станция" });
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Поиск: Ближайшее метро к старту" });
  await expect(search).toBeFocused();
  const listbox = page.getByRole("listbox", { name: "Ближайшее метро к старту" });
  await expect(listbox.getByRole("option")).toHaveCount(3);

  const box = await listbox.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  // The option is clickable over the first card: nothing on the page covers the popup.
  const option = listbox.getByRole("option", { name: /Павелецкая/ });
  const center = await option.evaluate(element => { const rect = element.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; });
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[role=option]")?.textContent ?? "", center)).toContain("Павелецкая");

  await search.fill("кольц");
  await expect(listbox.getByRole("option")).toHaveText(["ПавелецкаяЗамоскворецкая, Кольцевая"]);
  await search.press("Enter");
  await expect(trigger).toBeHidden();
  const chosen = page.getByRole("button", { name: "Ближайшее метро к старту Павелецкая" });
  await expect(chosen).toBeFocused();
  await expect(page.locator("ol > li")).toHaveCount(1);
  await expect(page.locator("ol > li").first()).toContainText("У Павелецкой");
});
