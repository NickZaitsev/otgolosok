import {expect, test, type Locator, type Page} from "@playwright/test";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import walk from "./fixtures/video-create-walk.json" with {type: "json"};
import type {WalkDocument} from "../src/features/walks/model";

// Снимки второй видеоинструкции: создание своей прогулки по времени и путь по ней.
// Кольцо вокруг Кремля построено планировщиком Отголоска, истории и озвучка —
// опубликованные материалы этих мест; всё сохранено в фикстуре.
test.use({deviceScaleFactor: 2});

type Box = {x: number; y: number; width: number; height: number};
const OUTPUT = "video/assets/guide/create";
const capturing = process.env.CAPTURE_VIDEO_GUIDE === "1";

async function settleMap(page: Page) {
  if (!capturing || !await page.locator(".leaflet-tile").count()) return;
  // Leaflet двигает слои и после загрузки плиток: ждём устойчивого положения.
  let previous = "";
  let stableSince = Date.now();
  await expect.poll(async () => {
    const state = await page.locator(".leaflet-tile").evaluateAll(images => ({
      ready: images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0 && getComputedStyle(image).opacity === "1" && getComputedStyle(image.parentElement!).opacity === "1"),
      geometry: images.map(image => `${(image as HTMLImageElement).src}:${image.getBoundingClientRect().x}:${image.getBoundingClientRect().y}`).join("|")
        + [...document.querySelectorAll(".leaflet-marker-icon")].map(marker => `${marker.getBoundingClientRect().x}:${marker.getBoundingClientRect().y}`).join("|"),
    }));
    if (!state.ready || previous !== state.geometry) stableSince = Date.now();
    previous = state.geometry;
    return state.ready && Date.now() - stableSince >= 700;
  }, {timeout: 30_000}).toBe(true);
}

// Экранная точка координаты по положению загруженной плитки OSM: карта Leaflet
// недоступна из теста, а плитка однозначно задаёт масштаб и сдвиг.
async function screenPoint(page: Page, lat: number, lon: number) {
  return page.locator(".leaflet-tile").evaluateAll((images, [lat, lon]) => {
    for (const image of images) {
      const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec((image as HTMLImageElement).src);
      const rect = image.getBoundingClientRect();
      if (!match || !rect.width || getComputedStyle(image).opacity !== "1") continue;
      const [z, tx, ty] = match.slice(1).map(Number);
      const size = 256 * 2 ** z, sin = Math.sin(lat * Math.PI / 180);
      const wx = (lon + 180) / 360 * size, wy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size;
      const scale = rect.width / 256;
      return {x: rect.x + (wx - tx * 256) * scale, y: rect.y + (wy - ty * 256) * scale};
    }
    return null;
  }, [lat, lon] as const);
}

// Перетаскивает карту, пока точка не окажется в target; шаг ограничен окном.
async function bringTo(page: Page, lat: number, lon: number, target: {x: number; y: number}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(500);
    const current = await screenPoint(page, lat, lon);
    expect(current).not.toBeNull();
    const dx = target.x - current!.x, dy = target.y - current!.y;
    if (Math.hypot(dx, dy) < 3) return;
    // Тянем за свободную от панели кромку карты: слева направо или справа налево.
    const stepX = Math.max(-1100, Math.min(1100, dx)), stepY = Math.max(-400, Math.min(400, dy));
    const from = {x: stepX >= 0 ? 60 : 1200, y: 420 - stepY / 2};
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + stepX, from.y + stepY, {steps: 12});
    // Пауза перед отпусканием гасит инерцию Leaflet, иначе карта проскакивает цель.
    await page.waitForTimeout(300);
    await page.mouse.up();
  }
  throw new Error("Не удалось подвести карту к точке старта");
}

test("видеоинструкция: своя прогулка по времени", async ({page, context}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width: 1280, height: 800});
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({latitude: walk.start.location.lat, longitude: walk.start.location.lon, accuracy: 10});

  const chapters = walk.chapters as Record<string, {status: string; story: {title: string}; audio: {url: string}}>;
  const stories = walk.plan.stops.map(stop => chapters[stop.contentId]);
  await page.route("**/api/**", route => route.fulfill({status: 404, json: {error: {message: "Нет в записи"}}}));
  await page.route("**/api/auth/session", route => route.fulfill({json: {user: null}}));
  await page.route("**/api/content/places?*", route => route.fulfill({json: {places: [], total: 0}}));
  await page.route("**/api/story-place?*", route => route.fulfill({json: {address: walk.start.address, location: walk.start.location}}));
  await page.route("**/api/walk-plan", route => route.fulfill({json: walk.plan}));
  await page.route("**/api/story-walks/resolve", route => {
    const {document, revision} = route.request().postDataJSON() as {document: WalkDocument; revision: number};
    const resolved = document.stops.map(stop => ({...chapters[stop.storyRef!.id], id: stop.id}));
    return route.fulfill({json: {document, revision, contentVersion: "f".repeat(64), chapters: resolved}});
  });
  await page.route("**/api/story-audio/*.mp3", async route => {
    const hash = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!/^[a-f0-9]{64}\.mp3$/.test(hash)) return route.fulfill({status: 404});
    return route.fulfill({contentType: "audio/mpeg", body: await readFile(`e2e/fixtures/audio/${hash}`)});
  });

  const targets: Record<string, Box> = {};
  async function capture(name: string, target: Locator | Box) {
    let box: Box | null;
    if ("boundingBox" in target) {
      await expect(target).toBeVisible();
      box = await target.boundingBox();
    } else box = target;
    expect(box).not.toBeNull();
    targets[`create/${name}`] = box!;
    if (capturing) {
      await settleMap(page);
      await mkdir(OUTPUT, {recursive: true});
      await page.screenshot({path: `${OUTPUT}/${name}.png`, animations: "disabled", style: "nextjs-portal { visibility: hidden; }"});
    }
  }

  await page.goto("/");
  const walkTab = page.getByRole("link", {name: "Прогулка", exact: true});
  await capture("home", walkTab);
  await walkTab.click();
  await expect(page.getByRole("heading", {name: "Прогулка", exact: true})).toBeVisible();

  // Подводим Манеж на открытое место слева от панели: щелчок попадает в сам старт.
  const point = {x: 235, y: 330};
  await bringTo(page, walk.start.location.lat, walk.start.location.lon, point);
  await capture("empty", {x: point.x - 30, y: point.y - 30, width: 60, height: 60});
  await page.mouse.click(point.x, point.y);
  const destination = page.getByRole("button", {name: "Куда", exact: true});
  await expect(page.getByRole("button", {name: "Откуда", exact: true})).toContainText(walk.start.address);
  await capture("start", destination);
  await destination.click();
  const byTime = page.getByRole("button", {name: "По времени", exact: true});
  await capture("choices", byTime);
  await byTime.click();
  const hour = page.getByRole("button", {name: "60 мин", exact: true});
  await capture("time", hour);
  await hour.click();
  await expect(hour).toHaveAttribute("aria-pressed", "true");
  await capture("time-60", page.getByRole("button", {name: "Готово", exact: true}));
  await page.getByRole("button", {name: "Готово", exact: true}).click();
  const build = page.getByRole("button", {name: "Построить прогулку", exact: true});
  await expect(destination).toContainText("60 мин пешком · с возвращением");
  await capture("ready", build);
  await build.click();
  await expect(page.getByRole("heading", {name: "Ваш маршрут", exact: true})).toBeVisible();
  const stops = page.getByText(`Остановки · ${walk.plan.stops.length}`, {exact: true});
  await capture("preview", stops);
  await stops.click();
  const open = page.getByRole("link", {name: "Начать прогулку", exact: true});
  await capture("stops", open);
  await open.click();

  await expect(page).toHaveURL(/\/walk\?local=/);
  const start = page.getByRole("button", {name: "Начать прогулку", exact: true});
  await expect(page.locator(".walk-session-map .leaflet-overlay-pane path").first()).toBeVisible();
  await capture("walk", start);
  await start.click();
  const pause = page.getByRole("button", {name: "Пауза", exact: true});
  await expect(pause).toBeVisible();
  // В режиме «По месту» остановка сменяется, только когда рассказ не звучит.
  await pause.click();
  await expect.poll(() => page.locator("audio").evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  await capture("listen", page.getByRole("button", {name: "Настройки прогулки"}));
  await page.getByRole("button", {name: "Настройки прогулки"}).click();
  const advance = page.getByLabel("Переключение остановок");
  await capture("settings", advance);
  await advance.selectOption("place");
  await capture("settings-place", advance);
  await page.getByRole("button", {name: "Настройки прогулки"}).click();

  const second = walk.plan.stops[1].location;
  const marker = page.locator(".explore-user-position");
  await capture("walking", marker);
  for (const [lat, lon] of [[second.lat + 0.0002, second.lon], [second.lat + 0.0001, second.lon], [second.lat, second.lon], [second.lat, second.lon + 0.00005]]) {
    await context.setGeolocation({latitude: lat, longitude: lon, accuracy: 8});
    await page.waitForTimeout(400);
  }
  await expect(page.getByRole("heading", {name: stories[1].story.title, exact: true})).toBeVisible();
  await capture("arrived", marker);

  const last = stories.length - 1;
  await page.getByRole("button", {name: /Остановки ·/}).click();
  await page.locator(".walk-session-stops button").nth(last).click();
  const finish = page.getByRole("button", {name: "Завершить", exact: true});
  await capture("last", finish);
  await finish.click();
  await expect(page.getByRole("heading", {name: "Прогулка завершена", exact: true})).toBeVisible();
  await capture("done", page.getByRole("link", {name: "На карту", exact: true}));

  if (capturing) await writeFile(`${OUTPUT}/targets.json`, JSON.stringify(targets, null, 2) + "\n");
});
