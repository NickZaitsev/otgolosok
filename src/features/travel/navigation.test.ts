import { describe, expect, it } from "vitest";
import { yandexNavigationUrl } from "./navigation";

describe("ссылки во внешний навигатор", () => {
  it("передаёт широту перед долготой и выбирает автомобильный маршрут", () => {
    const href = yandexNavigationUrl({ lat: 55.7522, lon: 37.6156 }, "driving");
    const url = new URL(href!);
    expect(url.origin).toBe("https://yandex.ru");
    expect(url.searchParams.get("rtext")).toBe("~55.7522,37.6156");
    expect(url.searchParams.get("rtt")).toBe("auto");
  });

  it("строит пеший возврат к машине", () => {
    const href = yandexNavigationUrl({ lat: 55.75, lon: 37.61 }, "walking");
    expect(new URL(href!).searchParams.get("rtt")).toBe("pd");
  });

  it.each([
    null,
    { lat: 91, lon: 37.61 },
    { lat: 55.75, lon: Number.NaN },
    { lat: "javascript:alert(1)", lon: 37.61 },
    "javascript:alert(1)",
  ])("не делает ссылку из неизвестного назначения %#", target => {
    expect(yandexNavigationUrl(target, "driving")).toBeNull();
  });
});
