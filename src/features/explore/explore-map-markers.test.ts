// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExploreMap, type MapItem } from "./explore-map";

let root: Root;
let container: HTMLDivElement;

const items = (): MapItem[] => [
  { id: "a", title: "Остановка 1: Дом", location: { lat: 55.75, lon: 37.6 }, number: 1 },
  { id: "b", title: "Остановка 2: Сад", location: { lat: 55.751, lon: 37.601 }, number: 2 },
];

async function render(value: MapItem[], selectedId?: string) {
  await act(async () => {
    root.render(createElement(ExploreMap, { items: value, selectedId, focus: null, user: null, onSelect: () => {}, onPoint: () => {} }));
  });
}

const pins = () => [...container.querySelectorAll<HTMLElement>(".explore-pin")];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps marker elements and keyboard focus across re-renders and selection", async () => {
  await render(items());
  await vi.waitFor(() => expect(pins()).toHaveLength(2));
  const [first, second] = pins();
  first.focus();

  await render(items());
  expect(pins()).toEqual([first, second]);
  expect(pins()[0]).toBe(first);

  await render(items(), "a");
  expect(pins()[0]).toBe(first);
  expect(first.classList.contains("selected")).toBe(true);
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(first);

  await render([{ ...items()[0], number: 3 }], "a");
  expect(pins()).toEqual([first]);
  expect(second.isConnected).toBe(false);
  expect(first.textContent).toBe("3");
});

it("exposes the map as a labelled region", async () => {
  await render(items());
  const map = container.querySelector(".explore-map");
  expect(map?.getAttribute("role")).toBe("region");
  expect(map?.getAttribute("aria-label")).toMatch(/^Карта историй/);
});
