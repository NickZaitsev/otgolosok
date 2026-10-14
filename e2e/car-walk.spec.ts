import { expect, test } from "./support/test";
import { carWalkDocument } from "../backend/test-fixtures/car-walk.mjs";
import type { WalkView } from "../src/features/walks/model";

for (const width of [390, 1280]) {
  test(`поездка с парковкой, возвратом и сохранением прогресса при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const document = carWalkDocument() as WalkView["document"];
    const view: WalkView = { document, revision: 0, contentVersion: "test:car", chapters: [{ id: "car-stop-1", status: "text_ready",
      story: { title: "История дома", address: "Москва, исторический дом", paragraphs: [{ text: "История этого дома.", factIds: [] }], sources: [], facts: [] }, audio: null }] };
    await page.route("**/api/story-walks/car-walk/view*", route => route.fulfill({ json: view }));
    await page.goto("/walk?catalog=car-walk");
    await expect(page.getByRole("button", { name: "Начать поездку" })).toBeVisible();
    await page.getByRole("button", { name: "Начать поездку" }).click();
    await expect(page.getByRole("link", { name: "Маршрут в навигаторе" })).toHaveAttribute("href", /rtt=auto/);
    await expect(page.getByText("В дороге звук остановлен")).toBeVisible();
    await expect(page.locator("audio")).not.toHaveAttribute("src");
    await page.getByRole("button", { name: "Я припарковался / Начать прогулку" }).click();
    await expect(page.getByRole("heading", { name: "История дома", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "История дома", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Вернуться к машине", exact: true }).click();
    await expect(page.getByRole("link", { name: "Маршрут к машине" })).toHaveAttribute("href", /rtt=pd/);
    await page.getByRole("button", { name: "Я у машины", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Поездка завершена" })).toBeVisible();
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("готовая прогулка создаёт автомобильную копию с теми же историями", async ({ page }) => {
  const car = carWalkDocument() as WalkView["document"];
  const source: WalkView = { document:{...car,id:"source-walk",travelMode:"walking",route:{...car.route!,distanceM:300,car:undefined}},revision:1,contentVersion:"source",chapters:[{id:"car-stop-1",status:"unavailable",story:null,audio:null}] };
  source.document.stops[0].storyRef={kind:"catalog",id:"source-walk--story"};
  await page.route("**/api/story-walks/source-walk/view*", route=>route.fulfill({json:source}));
  await page.route("**/api/walk-plan", async route=>{
    expect(route.request().postDataJSON().stops[0].stopId).toBe("car-stop-1");
    await route.fulfill({json:{...car.route,stops:car.stops.map(stop=>({...stop.place,stopId:stop.id}))}});
  });
  await page.route("**/api/story-walks/resolve*", async route=>{
    const document=route.request().postDataJSON().document;
    await route.fulfill({json:{...source,document,revision:0}});
  });
  await page.goto("/walk?catalog=source-walk");
  await page.getByRole("button", {name:"Пройти на машине",exact:true}).click();
  await expect(page.getByRole("button",{name:"Начать поездку",exact:true})).toBeVisible();
  const copy=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("otgolosok:walks:v2")!).items)[0] as {document:WalkView["document"]});
  expect(copy.document.travelMode).toBe("driving");
  expect(copy.document.stops[0].storyRef).toEqual(source.document.stops[0].storyRef);
  expect(copy.document.id).not.toBe(source.document.id);
});
