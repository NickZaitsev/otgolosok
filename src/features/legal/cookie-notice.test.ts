// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, expect, it, vi} from "vitest";
import {CookieNotice} from "./cookie-notice";
import {cookieChoice, cookieReceipt, openCookieSettings, saveCookieChoice} from "./cookie-consent";

vi.mock("../../../legal/publication.mjs", () => ({LEGAL_READY: true}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals();});
const receipt = "11111111-1111-4111-8111-111111111111." + "a".repeat(43);

it("предлагает равноправные решения и включает аналитику после подтверждения сервера", async () => {
  let respond!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => {respond = resolve;})));
  await act(async () => root.render(createElement(CookieNotice)));
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.map(button => button.textContent)).toEqual(["Только необходимые", "Разрешить аналитику"]);
  expect(container.querySelector('a[href="/legal/analytics-consent"]')).not.toBeNull();
  await act(async () => buttons[1].click());
  expect(cookieChoice()).toBeNull();
  expect(buttons.every(button => button.disabled)).toBe(true);
  await act(async () => respond(Response.json({receipt, decidedAt: Date.now()})));
  expect(cookieChoice()).toBe("accepted");
  expect(container.querySelector("aside")).toBeNull();
});

it("отказ закрывает уведомление без сети, настройки позволяют открыть его снова", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await act(async () => root.render(createElement(CookieNotice)));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(cookieChoice()).toBe("rejected");
  expect(container.querySelector("aside")).toBeNull();
  await act(async () => openCookieSettings());
  expect(container.querySelector("aside")).not.toBeNull();
  expect(container.textContent).toContain("Закрыть");
});

it("отказ сервера оставляет уведомление и показывает ошибку без включения аналитики", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", {status: 403})));
  await act(async () => root.render(createElement(CookieNotice)));
  await act(async () => container.querySelectorAll<HTMLButtonElement>("button")[1].click());
  expect(cookieChoice()).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Аналитика остаётся выключенной");
  expect(container.querySelector("aside")).not.toBeNull();
});

it("при отказе сервера сообщает о локальном отзыве и сохраняет подтверждение для повторной попытки", async () => {
  saveCookieChoice(true, receipt);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", {status: 403})));
  await act(async () => root.render(createElement(CookieNotice)));
  await act(async () => openCookieSettings());
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(cookieChoice()).toBe("rejected");
  expect(cookieReceipt()).toBe(receipt);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Аналитика выключена на этом устройстве. Не удалось подтвердить отзыв на сервере. Повторите выбор.");
  expect(container.querySelector("aside")).not.toBeNull();
});
