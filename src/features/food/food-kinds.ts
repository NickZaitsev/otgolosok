import { MAP_ICONS } from "../explore/map-icons";
import type { FoodKind } from "./types";

export const FOOD_GROUPS = {
  coffee: { label: "Кофейни", icon: "foodCoffee", colorToken: "--muted", kinds: ["coffee"] },
  meal: { label: "Кафе и рестораны", icon: "foodMeal", colorToken: "--teal", kinds: ["cafe", "restaurant"] },
  snack: { label: "Перекус", icon: "foodSnack", colorToken: "--map-orange", kinds: ["fast_food", "bakery"] },
  bar: { label: "Бары и пабы", icon: "foodBar", colorToken: "--map-green", kinds: ["bar"] },
} as const;
const GROUP_FOR_KIND = { coffee: "coffee", cafe: "meal", restaurant: "meal", fast_food: "snack", bakery: "snack", bar: "bar" } as const;
export const foodGroup = (kind: FoodKind) => FOOD_GROUPS[GROUP_FOR_KIND[kind]];
export const foodIcon = (kind: FoodKind) => MAP_ICONS[foodGroup(kind).icon];
const LABELS: Record<FoodKind, string> = { coffee: "Кофейня", cafe: "Кафе", restaurant: "Ресторан", fast_food: "Быстрое питание", bakery: "Пекарня", bar: "Бар или паб" };
export const foodKindLabel = (kind: FoodKind) => LABELS[kind];
const CUISINES: Record<string, string> = {
  coffee_shop: "Кофе", pizza: "Пицца", burger: "Бургеры", sushi: "Суши", russian: "Русская кухня", georgian: "Грузинская кухня",
  italian: "Итальянская кухня", japanese: "Японская кухня", asian: "Азиатская кухня", chinese: "Китайская кухня", uzbek: "Узбекская кухня",
  bakery: "Выпечка", ice_cream: "Мороженое", shawarma: "Шаурма", kebab: "Кебаб", turkish: "Турецкая кухня", indian: "Индийская кухня",
  korean: "Корейская кухня", vietnamese: "Вьетнамская кухня", thai: "Тайская кухня", mexican: "Мексиканская кухня", french: "Французская кухня",
  american: "Американская кухня", european: "Европейская кухня", international: "Международная кухня", regional: "Местная кухня",
  seafood: "Морепродукты", fish: "Рыба", steak_house: "Стейки", grill: "Гриль", chicken: "Курица", sandwich: "Сэндвичи", pancakes: "Блины",
  crepe: "Блины", dessert: "Десерты", cake: "Торты", confectionery: "Сладости", tea: "Чай", doughnut: "Пончики", noodles: "Лапша",
};
export function cuisineLabels(value: string | null): string[] {
  return [...new Set((value ?? "").split(";").map(tag => CUISINES[tag.trim().toLowerCase()]).filter((label): label is string => typeof label === "string"))];
}
export function formatFoodCategory(kind: FoodKind, cuisine: string | null): string {
  return [foodKindLabel(kind), ...cuisineLabels(cuisine)].join(" · ");
}
