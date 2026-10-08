// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../legal/publication.mjs", () => ({ LEGAL_READY: true }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.ym;
  document.head.innerHTML = "";
  localStorage.clear();
});

it("не загружает счётчик и не создаёт очередь без согласия", async () => {
  const { trackPage } = await import("./metrika");
  trackPage("https://otgolosok.online/");
  expect(window.ym).toBeUndefined();
  expect(document.querySelector("script")).toBeNull();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("инициализирует счётчик один раз и учитывает переходы с правильным referer", async () => {
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage, METRIKA_ID, METRIKA_SCRIPT } = await import("./metrika");
  trackPage("https://otgolosok.online/");
  trackPage("https://otgolosok.online/");
  trackPage("https://otgolosok.online/walk?id=one");
  trackPage("https://otgolosok.online/walk?id=two");
  trackPage("https://otgolosok.online/");
  expect(document.querySelectorAll("script")).toHaveLength(1);
  expect(document.querySelector("script")?.src).toBe(METRIKA_SCRIPT);
  expect(window.ym?.a).toHaveLength(4);
  expect(window.ym?.a?.[0]).toEqual([METRIKA_ID, "init", expect.objectContaining({ defer: true, webvisor: false, clickmap: false, trackLinks: false, sendTitle: false })]);
  expect(window.ym?.a?.slice(1).map(command => command[2])).toEqual([
    new URL("/", location.origin).href, new URL("/walk", location.origin).href, new URL("/", location.origin).href,
  ]);
  expect(window.ym?.a?.[2][3]).toEqual(expect.objectContaining({ referer: new URL("/", location.origin).href }));
});

it.each(["error", "timeout"])("ограничивает повторы при %s и очищает очередь после отказа", async failure => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage } = await import("./metrika");
  trackPage("https://otgolosok.online/");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (failure === "error") document.querySelector("script")!.dispatchEvent(new Event("error"));
    else await vi.advanceTimersByTimeAsync(15000);
    if (attempt < 2) await vi.advanceTimersByTimeAsync(1000 * 2 ** attempt);
  }
  trackPage("https://otgolosok.online/history");
  await vi.runAllTimersAsync();
  expect(document.querySelector("script")).toBeNull();
  expect(window.ym?.a).toEqual([]);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("после успешной загрузки не запускает повторный скрипт по таймеру", async () => {
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage } = await import("./metrika");
  trackPage("https://otgolosok.online/");
  const script = document.querySelector("script")!;
  script.dispatchEvent(new Event("load"));
  await vi.runAllTimersAsync();
  expect(document.querySelector("script")).toBe(script);
  expect(window.ym?.a).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("ошибка стороннего счётчика не прерывает приложение", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  window.ym = () => { throw new Error("third party error"); };
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage } = await import("./metrika");
  expect(() => trackPage("https://otgolosok.online/")).not.toThrow();
  expect(document.querySelector("script")).toBeNull();
});


it("отзыв отменяет повторы и удаляет только аналитические cookie", async () => {
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage, stopMetrika } = await import("./metrika");
  trackPage(location.href);
  document.cookie = "_ym_uid=test; Path=/";
  document.cookie = "otgolosok.session=keep; Path=/";
  document.querySelector("script")!.dispatchEvent(new Event("error"));
  saveCookieChoice(false);
  stopMetrika();
  await vi.runAllTimersAsync();
  trackPage(location.href);
  expect(document.querySelector("script")).toBeNull();
  expect(window.ym?.a).toEqual([]);
  expect(document.cookie).not.toContain("_ym_uid");
  expect(document.cookie).toContain("otgolosok.session=keep");
  expect(vi.getTimerCount()).toBe(0);
});

it("отзыв останавливает загруженный SDK с сохранённой очередью и удаляет его дочерние скрипты", async () => {
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage, stopMetrika } = await import("./metrika");
  trackPage(location.href);
  const queue = window.ym!.a!;
  let active = true;
  const heartbeat = window.setInterval(() => {
    if (active) document.cookie = "_ym_uid=renewed; Path=/";
  }, 1000);
  // Real Metrica retains ym.a and subscribes to the array's push method.
  const originalPush = queue.push;
  queue.push = function (...commands) {
    for (const command of commands) if (command[1] === "destruct") { active = false; window.clearInterval(heartbeat); }
    return originalPush.apply(this, commands);
  };
  document.querySelector("script")!.dispatchEvent(new Event("load"));
  const child = document.createElement("script");
  child.src = "https://mc.yandex.ru/metrika/tag_phono.js";
  document.head.append(child);
  const application = document.createElement("script");
  application.src = "/_next/static/application.js";
  document.head.append(application);
  saveCookieChoice(false);
  stopMetrika();
  await vi.advanceTimersByTimeAsync(1500);
  expect(active).toBe(false);
  expect(document.querySelector('script[src*="mc.yandex.ru/metrika/"]')).toBeNull();
  expect(document.head.contains(application)).toBe(true);
  expect(window.ym?.a).toHaveLength(0);
  expect(document.cookie).not.toContain("_ym_uid");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["/login", "/account", "/admin", "/en/login", "/zh/account"])("исключает приватный маршрут %s", async path => {
  const { saveCookieChoice } = await import("../legal/cookie-consent");
  saveCookieChoice(true, "11111111-1111-4111-8111-111111111111." + "a".repeat(43));
  const { trackPage } = await import("./metrika");
  trackPage(new URL(path, location.origin).href);
  expect(window.ym).toBeUndefined();
  expect(document.querySelector("script")).toBeNull();
});
