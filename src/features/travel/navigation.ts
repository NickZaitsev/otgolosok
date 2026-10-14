import type { Coordinates } from "../tour/types";

export type NavigationMode = "driving" | "walking";

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const { lat, lon } = value as Partial<Coordinates>;
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

/**
 * A directions link is built from checked coordinates only. Keeping the destination
 * structural means values read from old or damaged offline copies cannot inject a URL.
 */
export function yandexNavigationUrl(target: unknown, mode: NavigationMode): string | null {
  if (!isCoordinates(target)) return null;
  const url = new URL("https://yandex.ru/maps/");
  url.searchParams.set("rtext", `~${target.lat},${target.lon}`);
  url.searchParams.set("rtt", mode === "driving" ? "auto" : "pd");
  return url.toString();
}

