import { describe, expect, it } from "vitest";
import { localeFromPath, localizedPath, unlocalizedPath } from "./locale";
import { translate, mergeTranslations } from "./translate";

describe("языковые адреса", () => {
  it.each([
    ["/", "ru"], ["/en", "en"], ["/en/walk", "en"], ["/zh/history", "zh"], ["/enough", "ru"], ["/admin", "ru"],
  ] as const)("распознаёт %s", (path, locale) => expect(localeFromPath(path)).toBe(locale));
  it.each([
    ["/?place=osm:node:123#story", "en", "/en?place=osm:node:123#story"],
    ["/en/walk?share=abc#top", "zh", "/zh/walk?share=abc#top"],
    ["/zh/history/?tab=local", "ru", "/history?tab=local"],
    ["/en", "ru", "/"], ["/login?returnTo=%2Fen%2Fwalk", "en", "/en/login?returnTo=%2Fen%2Fwalk"],
    ["/trends", "en", "/en/trends"], ["/account/walks", "zh", "/zh/account/walks"],
    ["/api/me", "zh", "/api/me"], ["/admin", "en", "/admin"], ["/audio/story.mp3", "zh", "/audio/story.mp3"],
    ["https://example.com/walk", "en", "https://example.com/walk"], ["//evil.test/walk", "en", "//evil.test/walk"],
    ["/place/node/123", "en", "/place/node/123"], ["/unknown", "en", "/unknown"],
  ] as const)("переводит адрес %s на %s", (path, locale, expected) => expect(localizedPath(path, locale)).toBe(expected));
  it("не принимает начало чужого имени за префикс языка", () => expect(unlocalizedPath("/english")).toBe("/english"));
});

describe("словарь интерфейса", () => {
  it("переводит независимые английский и китайский сообщения", () => {
    expect(translate("en", "Отдалить")).toBe("Zoom out");
    expect(translate("zh", "Отдалить")).toBe("缩小");
    expect(translate("ru", "Отдалить")).toBe("Отдалить");
  });
  it("подставляет параметры в исходный русский текст без форматных спецэффектов", () => {
    expect(translate("ru", "Маршрут {name}: {count}", { name: "$& {other}", count: 2 })).toBe("Маршрут $& {other}: 2");
  });
  it("сохраняет неизвестную строку и не теряет неизвестный placeholder", () => {
    expect(translate("en", "No translation {value}")).toBe("No translation {value}");
  });
  it("позволяет одинаковые переводы и выявляет конфликтующие значения", () => {
    expect(mergeTranslations({ "Да": ["Yes", "是"] }, { "Да": ["Yes", "是"] })["Да"]).toEqual(["Yes", "是"]);
    expect(() => mergeTranslations({ "Да": ["Yes", "是"] }, { "Да": ["Sure", "是"] })).toThrow("Conflicting interface translation");
  });
  it("не использует унаследованные свойства как перевод", () => expect(translate("en", "toString")).toBe("toString"));
});
