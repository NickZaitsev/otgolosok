import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Coordinates } from "../tour/types";
import { foodCellStore } from "./food-cells";
import { createFoodHoursCache } from "./food-walk-model";
import { cellsForRoute, placesAlongRoute } from "./route-proximity";

export function useWalkFood(geometry: Coordinates[], mode: "open" | "loop", visible: boolean) {
  const snapshot = useSyncExternalStore(foodCellStore.subscribe, foodCellStore.snapshot, foodCellStore.snapshot);
  const keys = useMemo(() => cellsForRoute(geometry), [geometry]);
  const [hours] = useState(createFoodHoursCache);
  const [requestError, setRequestError] = useState(false);
  useEffect(() => {
    if (geometry.length < 2) return;
    let disposed = false;
    foodCellStore.loadManifest().catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [geometry]);
  useEffect(() => {
    if (!visible || !snapshot.manifest || snapshot.unavailable) return;
    let disposed = false;
    foodCellStore.loadKeys(keys).catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [visible, keys, snapshot.manifest, snapshot.unavailable]);
  const places = useMemo(() => placesAlongRoute(snapshot.places, geometry, { mode }), [snapshot.places, geometry, mode]);
  const relevant = keys.filter(key => snapshot.manifestKeys?.has(key));
  const error = requestError || snapshot.manifestStatus === "error" || relevant.some(key => snapshot.cellStatus.get(key) === "error");
  const loading = !snapshot.manifest || relevant.some(key => !snapshot.loadedKeys.has(key) && snapshot.cellStatus.get(key) !== "error");
  async function retry() {
    setRequestError(false);
    try { await foodCellStore.retry(); if (visible) await foodCellStore.loadKeys(keys); }
    catch { setRequestError(true); }
  }
  return { ...snapshot, places, hours, error, loading, retry };
}
