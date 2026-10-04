export type FoodKind = "coffee" | "cafe" | "restaurant" | "fast_food" | "bakery" | "bar";
export type FoodPlace = {
  id: string; kind: FoodKind; name: string; lat: number; lon: number;
  address: string | null; openingHours: string | null; cuisine: string | null; website: string | null; phone: string | null;
};
