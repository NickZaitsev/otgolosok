// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.ym;
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("инициализирует счётчик один раз и учитывает переходы с правильным referer", async () => {
  const { trackPage, METRIKA_ID, METRIKA_SCRIPT } = await import("./metrika");
  trackPage("https://otgolosok.online/");
  trackPage("https://otgolosok.online/");
  trackPage("https://otgolosok.online/walk?id=one");
  trackPage("https://otgolosok.online/walk?id=two");
  trackPage("https://otgolosok.online/");
  expect(document.querySelectorAll("script")).toHaveLength(1);
  expect(document.querySelector("script")?.src).toBe(METRIKA_SCRIPT);
  expect(window.ym?.a).toHaveLength(5);
  expect(window.ym?.a?.[0]).toEqual([METRIKA_ID, "init", expect.objectContaining({ defer: true, webvisor: true })]);
  expect(window.ym?.a?.slice(1).map(command => command[2])).toEqual([
    "https://otgolosok.online/", "https://otgolosok.online/walk?id=one",
    "https://otgolosok.online/walk?id=two", "https://otgolosok.online/",
  ]);
  expect(window.ym?.a?.[3][3]).toEqual(expect.objectContaining({ referer: "https://otgolosok.online/walk?id=one" }));
});

it.each(["error", "timeout"])("ограничивает повторы при %s и очищает очередь после отказа", async failure => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
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
  const { trackPage } = await import("./metrika");
  expect(() => trackPage("https://otgolosok.online/")).not.toThrow();
  expect(document.querySelector("script")).toBeNull();
});
