// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cityAtPoint, CURRENT_CITY_KEY, readCurrentCity, rememberCity, useCurrentCity, CITIES } from "./current-city";

const [moscow, kazan] = CITIES;

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("cityAtPoint", () => {
  it.each([
    ["Кремль", { lat: 55.752, lon: 37.6175 }, "moscow"],
    ["Казанский кремль", { lat: 55.7987, lon: 49.1056 }, "kazan"],
    ["между городами", { lat: 55.8, lon: 43 }, null],
    ["Петербург", { lat: 59.94, lon: 30.31 }, null],
  ])("%s", (_name, point, expected) => expect(cityAtPoint(point)?.id ?? null).toBe(expected));
});

describe("текущий город", () => {
  it.each([
    ["ничего не сохранено", null, "moscow"],
    ["сохранена Казань", "kazan", "kazan"],
    ["неизвестный город", "spb", "moscow"],
  ])("%s", (_name, saved, expected) => {
    if (saved) localStorage.setItem(CURRENT_CITY_KEY, saved);
    expect(readCurrentCity().id).toBe(expected);
  });

  it("выбор сохраняется и сразу доходит до подписчиков", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const seen: string[] = [];
    const Probe = () => { const [city] = useCurrentCity(); seen.push(city.id); return null; };
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { rememberCity(kazan); });
    expect(seen.at(-1)).toBe("kazan");
    expect(localStorage.getItem(CURRENT_CITY_KEY)).toBe("kazan");
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  });

  it("если запись не удалась, выбор в памяти важнее прежнего сохранённого города", () => {
    localStorage.setItem(CURRENT_CITY_KEY, "moscow");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    rememberCity(kazan);
    expect(readCurrentCity().id).toBe("kazan");
    vi.restoreAllMocks();
    rememberCity(moscow);
  });

  it("без доступа к хранилищу выбор держится до перезагрузки", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    rememberCity(kazan);
    expect(readCurrentCity().id).toBe("kazan");
    vi.restoreAllMocks();
    rememberCity(moscow);
    expect(readCurrentCity().id).toBe("moscow");
  });
});
