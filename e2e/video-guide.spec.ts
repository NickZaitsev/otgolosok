import {expect, test, type Locator} from "@playwright/test";
import {mkdir, writeFile} from "node:fs/promises";
import {routeToWalkView} from "../src/features/walks/adapters";
import routeData from "../public/data/routes/paveletskaya.json" with {type: "json"};
import type {Route} from "../src/features/tour/types";

test("видеоинструкция: от каталога до следующей остановки", async ({page}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width: 1280, height: 800});
  await page.route("**/api/auth/session", route => route.fulfill({json: {user: null}}));
  await page.route("**/api/story-walks", route => route.fulfill({json: {walks: [{...routeData, id: "paveletskaya"}]}}));
  await page.route("**/api/story-walks/paveletskaya/view", route => route.fulfill({json: routeToWalkView(routeData as Route)}));
  const targets: Record<string, {x: number; y: number; width: number; height: number}> = {};
  async function capture(name: string, target: Locator) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    targets[name] = box!;
    if (process.env.CAPTURE_VIDEO_GUIDE === "1") {
      if (await page.locator(".leaflet-tile").count()) {
        // Раскрытие панели меняет границы карты: ждём не только изображения,
        // но и устойчивое положение слоёв после окончания движения Leaflet.
        let previous = "";
        let stableSince = Date.now();
        await expect.poll(async () => {
          const state = await page.locator(".leaflet-tile").evaluateAll(images => ({
            ready: images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0 && getComputedStyle(image).opacity === "1" && getComputedStyle(image.parentElement!).opacity === "1"),
            geometry: images.map(image => `${(image as HTMLImageElement).src}:${image.getBoundingClientRect().toJSON().x}:${image.getBoundingClientRect().toJSON().y}`).join("|"),
          }));
          if (!state.ready || previous !== state.geometry) stableSince = Date.now();
          previous = state.geometry;
          return state.ready && Date.now() - stableSince >= 500;
        }, {timeout: 30_000}).toBe(true);
      }
      await mkdir("video/assets/guide", {recursive: true});
      await page.screenshot({path: `video/assets/guide/${name}.png`, animations: "disabled", style: "nextjs-portal { visibility: hidden; }"});
    }
  }
  await page.goto("/history");
  const ready = page.locator('a[href="/walk?catalog=paveletskaya"]');
  await ready.scrollIntoViewIfNeeded();
  await capture("catalog", ready);
  await ready.click();
  const start = page.getByRole("button", {name: "Начать прогулку", exact: true});
  await expect(page.locator(".walk-session-map .leaflet-overlay-pane path").first()).toBeVisible();
  if (process.env.CAPTURE_VIDEO_GUIDE === "1") {
    await expect.poll(() => page.locator(".leaflet-tile").evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)), {timeout: 30_000}).toBe(true);
  }
  await capture("route", start);
  await start.click();
  const pause = page.getByRole("button", {name: "Пауза", exact: true});
  await expect(pause).toBeVisible();
  await capture("listen", pause);
  await pause.click();
  await expect.poll(() => page.locator("audio").evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  const read = page.getByRole("button", {name: "Читать историю"});
  await capture("read-button", read);
  await read.click();
  await expect(page.locator(".walk-session-drawer .story-text")).toBeVisible();
  await capture("text", read);
  await read.click();
  const settings = page.getByRole("button", {name: "Настройки прогулки"});
  await capture("settings-button", settings);
  await settings.click();
  await page.getByLabel("Переключение остановок").selectOption("manual");
  await page.getByLabel("Скорость аудио").selectOption("1.25");
  await capture("settings", page.getByLabel("Скорость аудио"));
  await settings.click();
  const stops = page.getByRole("button", {name: /Остановки ·/});
  await capture("stops-button", stops);
  await stops.click();
  const second = page.locator(".walk-session-stops button").nth(1);
  await capture("stops", second);
  await second.click();
  await expect(page.getByRole("heading", {name: "Название с оврагом внутри", exact: true})).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate(el => (el as HTMLAudioElement).playbackRate)).toBe(1.25);
  await capture("next", page.getByRole("button", {name: "Дальше", exact: true}));
  if (process.env.CAPTURE_VIDEO_GUIDE === "1") {
    await writeFile("video/assets/guide/targets.json", JSON.stringify(targets, null, 2) + "\n");
  }
});
