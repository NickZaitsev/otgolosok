import type { FoodPlace } from "./types";
export const foodPlace = (id = "osm:node:1", lat = 55.751, lon = 37.601): FoodPlace => ({
  id, lat, lon, kind: "coffee", name: "Кофейня", address: null, openingHours: null, cuisine: null, website: null, phone: null,
});
