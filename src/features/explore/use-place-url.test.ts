// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Next's patched History API feeds useSearchParams; here the hook reads the jsdom location directly.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(location.search) }));
const { usePlaceUrl } = await import("./use-place-url");

let root: Root;
type PlaceUrl = ReturnType<typeof usePlaceUrl>;
let latest: PlaceUrl;
function Probe({ report }: { report: (value: PlaceUrl) => void }) {
  const value = usePlaceUrl();
  useEffect(() => report(value));
  return null;
}
const render = () => act(async () => root.render(createElement(Probe, { report: value => { latest = value; } })));
const here = () => `${location.pathname}${location.search}`;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); });

it.each([
  ["/", null, false],
  ["/?place=osm:node:1", "osm:node:1", false],
  ["/?place=osm%3Away%3A2&debug=1", "osm:way:2", false],
  ["/?place=garbage", null, true],
])("reads %s", async (url, place, invalid) => {
  history.replaceState(null, "", url);
  await render();
  expect(latest.urlPlace).toBe(place);
  expect(latest.invalid).toBe(invalid);
});

it("makes every opened place a history step with a readable id and keeps other parameters", async () => {
  history.replaceState(null, "", "/?debug=1");
  await render();
  const push = vi.spyOn(history, "pushState");
  latest.openPlace("osm:node:1");
  expect(here()).toBe("/?place=osm:node:1&debug=1");
  latest.openPlace("osm:way:2");
  expect(here()).toBe("/?place=osm:way:2&debug=1");
  latest.openPlace("osm:way:2");
  expect(push).toHaveBeenCalledTimes(2);
  // A fresh state for Next to complete: one carrying `__NA` would bypass its router.
  for (const [state] of push.mock.calls) expect(state).toEqual({});
});

it("adds a step without the place when it closes, or rewrites the current entry", async () => {
  history.replaceState(null, "", "/?place=osm:node:1");
  await render();
  const push = vi.spyOn(history, "pushState"), replace = vi.spyOn(history, "replaceState");
  latest.leavePlace();
  expect(here()).toBe("/");
  expect(push).toHaveBeenCalledOnce();
  // Nothing to leave: no step.
  latest.leavePlace();
  expect(push).toHaveBeenCalledOnce();

  history.replaceState(null, "", "/?place=garbage&debug=1");
  replace.mockClear();
  latest.leavePlace({ replace: true });
  expect(here()).toBe("/?debug=1");
  expect(replace).toHaveBeenCalledWith({}, "", "/?debug=1");
  expect(push).toHaveBeenCalledOnce();
});

it("rewrites the current entry with an exact URL", async () => {
  history.replaceState(null, "", "/?walk=create&address=x");
  await render();
  const push = vi.spyOn(history, "pushState");
  latest.replaceUrl("/?place=osm:node:3");
  expect(here()).toBe("/?place=osm:node:3");
  expect(history.length).toBeGreaterThan(0);
  expect(push).not.toHaveBeenCalled();
});
