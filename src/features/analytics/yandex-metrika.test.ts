// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NODE_ENV", "production");
  delete window.ym;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const script of document.querySelectorAll("script")) {
    script.dispatchEvent(new Event("load"));
    script.remove();
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("учитывает маршруты и query при навигации, включая возврат назад, без дубля StrictMode", async () => {
  const { YandexMetrika } = await import("./yandex-metrika");
  for (const path of ["/", "/walk?id=one", "/walk?id=two", "/"]) {
    window.history.pushState({}, "", path);
    await act(async () => root.render(createElement(StrictMode, null, createElement(YandexMetrika))));
  }
  expect(window.ym?.a?.filter(command => command[1] === "hit").map(command => new URL(String(command[2])).pathname + new URL(String(command[2])).search))
    .toEqual(["/", "/walk?id=one", "/walk?id=two", "/"]);
  expect(document.querySelectorAll("script")).toHaveLength(1);
});

it("не загружает аналитику в режиме разработки", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const { YandexMetrika } = await import("./yandex-metrika");
  await act(async () => root.render(createElement(YandexMetrika)));
  expect(window.ym).toBeUndefined();
  expect(document.querySelector("script")).toBeNull();
});
