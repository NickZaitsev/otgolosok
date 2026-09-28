// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalkCreationPanel } from "./walk-creation-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

const button = (name: string) => [...container.querySelectorAll("button")].find(item => item.textContent === name || item.getAttribute("aria-label") === name);

it("ignores a geolocation fix that arrives after the panel was closed", async () => {
  let deliver: PositionCallback | undefined;
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: (success: PositionCallback) => { deliver = success; } } });
  await act(async () => {
    root.render(createElement(WalkCreationPanel, { onClose: () => {}, onMap: () => {}, picked: null }));
  });
  await act(async () => { button("Откуда")?.click(); });
  await act(async () => { button("Моё местоположение")?.click(); });
  expect(deliver).toBeTypeOf("function");

  await act(async () => { root.unmount(); });
  await act(async () => { deliver?.({ coords: { latitude: 55.75, longitude: 37.6 } } as GeolocationPosition); });

  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/story-place"))).toEqual([]);
});
