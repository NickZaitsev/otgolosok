import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cuisineLabels, foodGroup, foodIcon, formatFoodCategory } from "./food-kinds";
import type { FoodKind } from "./types";

it.each<[FoodKind, string]>([["coffee", "Кофейни"], ["cafe", "Кафе и рестораны"], ["restaurant", "Кафе и рестораны"], ["fast_food", "Перекус"], ["bakery", "Перекус"], ["bar", "Бары и пабы"]])("category and icon for %s", (kind, label) => {
  expect(foodGroup(kind).label).toBe(label);
  expect(foodIcon(kind).glyph).toMatch(/^M/);
});
it.each(["coffee", "cafe", "restaurant", "fast_food", "bakery", "bar"] as FoodKind[])("%s uses an existing token and white contrast ≥ 4.5:1", kind => {
  const icon = foodIcon(kind), token = foodGroup(kind).colorToken;
  const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
  expect(css).toContain(`${token}: ${icon.color};`);
  const channels = icon.color.slice(1).match(/../g)!.map(hex => parseInt(hex, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  expect(1.05 / (luminance + .05)).toBeGreaterThanOrEqual(4.5);
});
it.each([
  ["coffee_shop;pizza;burger;sushi", ["Кофе", "Пицца", "Бургеры", "Суши"]],
  ["russian;georgian;italian;japanese;asian;chinese;uzbek", ["Русская кухня", "Грузинская кухня", "Итальянская кухня", "Японская кухня", "Азиатская кухня", "Китайская кухня", "Узбекская кухня"]],
  ["bakery;ice_cream;shawarma", ["Выпечка", "Мороженое", "Шаурма"]], [" Pizza ;unknown;pizza", ["Пицца"]], [null, []], ["unknown", []], ["__proto__;constructor;toString", []],
])("translates %j without leaking unknown raw tags", (value, labels) => expect(cuisineLabels(value)).toEqual(labels));
it("formats the category with translated cuisine only", () => {
  expect(formatFoodCategory("restaurant", "georgian;unknown")).toBe("Ресторан · Грузинская кухня");
  expect(formatFoodCategory("coffee", "unknown")).toBe("Кофейня");
});
