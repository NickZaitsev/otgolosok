import { fetchWithRetry } from "../walk-builder/request";
import type { NearbyParking, ParkingPlace } from "./types";

const invalid = () => new Error("Некорректные данные парковок.");
const point = (value: unknown): value is { lat: number; lon: number } => {
  const p = value as { lat?: unknown; lon?: unknown } | null;
  return !!p && typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && typeof p.lon === "number" && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
};

export function isParkingPlace(value: unknown): value is ParkingPlace {
  const place = value as ParkingPlace | null;
  return !!place && typeof place.id === "string" && /^osm:(node|way|relation):\d+$/.test(place.id)
    && typeof place.name === "string" && place.name.trim().length > 0 && place.name.length <= 180
    && point(place.location) && point(place.entrance) && point(place.exit) && point(place.pedestrianAccess)
    && (place.access === "public" || place.access === "unknown")
    && (place.fee === null || typeof place.fee === "boolean")
    && (place.openingHours === null || typeof place.openingHours === "string");
}

function source(value: unknown): value is { sourceEditedAt: string; attribution: string } {
  const item = value as { sourceEditedAt?: unknown; attribution?: unknown } | null;
  return !!item && typeof item.sourceEditedAt === "string" && Number.isFinite(Date.parse(item.sourceEditedAt))
    && typeof item.attribution === "string" && item.attribution.trim().length > 0;
}

export function parseNearbyParking(value: unknown): NearbyParking {
  const result = value as NearbyParking | null;
  if (!result || !source(result) || !Array.isArray(result.places) || !result.places.every(isParkingPlace)
    || new Set(result.places.map(place => place.id)).size !== result.places.length) throw invalid();
  return result;
}

export async function loadNearbyParking(location: { lat: number; lon: number }, radiusM = 1000, signal?: AbortSignal) {
  const query = new URLSearchParams({ lat: String(location.lat), lon: String(location.lon), radius: String(radiusM) });
  const response = await fetchWithRetry(`/api/parking/near?${query}`, signal ?? new AbortController().signal);
  return parseNearbyParking(await response.json());
}
