import { useCallback, useSyncExternalStore } from "react";
import { CITIES, cityAt, MOSCOW, type City } from "../../../backend/cities.mjs";
import type { Coordinates } from "../tour/types";

export type CityId = City["id"];
export { CITIES, MOSCOW, type City };

/** The city the listener chose last or was located in; it opens the map and filters the trends. */
export const CURRENT_CITY_KEY = "otgolosok:city:v1";
const CHANGE = "otgolosok:city-change";

export const cityById = (id: unknown): City | null => CITIES.find(city => city.id === id) ?? null;

/** The city whose walk area holds the point, or null outside every city. */
export const cityAtPoint = (point: Coordinates): City | null => cityAt(point.lat, point.lon);

// Without storage the choice still holds until the page is reloaded.
let memory: CityId | null = null;

export function rememberCity(city: City) {
  try { localStorage.setItem(CURRENT_CITY_KEY, city.id); memory = null; } catch { memory = city.id; }
  window.dispatchEvent(new Event(CHANGE));
}

const snapshot = (): CityId => {
  try { return cityById(localStorage.getItem(CURRENT_CITY_KEY))?.id ?? memory ?? MOSCOW.id; } catch { return memory ?? MOSCOW.id; }
};
/** The saved city; Moscow when nothing is saved or the value is unknown. */
export const readCurrentCity = (): City => cityById(snapshot()) ?? MOSCOW;

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGE, notify);
  // Another tab chose a city.
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(CHANGE, notify); window.removeEventListener("storage", notify); };
};

const never = () => () => {};

/**
 * The current city, a setter and whether the saved choice is read yet: the static page renders Moscow
 * until hydration, so a request for the city waits for `known`.
 */
export function useCurrentCity(): [City, (city: City) => void, boolean] {
  const id = useSyncExternalStore(subscribe, snapshot, () => null);
  const known = useSyncExternalStore(never, () => true, () => false);
  const choose = useCallback((city: City) => rememberCity(city), []);
  return [cityById(id) ?? MOSCOW, choose, known];
}
