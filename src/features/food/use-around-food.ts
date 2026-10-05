import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { MapViewport } from "../explore/catalog-bounds";
import { foodCellStore, foodCellsFor } from "./food-cells";
import { createFoodHoursCache } from "./food-walk-model";
import { FOOD_MIN_ZOOM, FOOD_TOGGLE_KEY, visibleFoodPlaces } from "./food-viewport";

export function useAroundFood(creating: boolean) {
  const snapshot = useSyncExternalStore(foodCellStore.subscribe, foodCellStore.snapshot, foodCellStore.snapshot);
  const [enabled, setEnabled] = useState(false);
  const [viewport, onViewport] = useState<MapViewport | null>(null);
  const [hours] = useState(createFoodHoursCache);
  const [requestError, setRequestError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setEnabled(localStorage.getItem(FOOD_TOGGLE_KEY) === "1"); } catch { /* Storage is optional. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (creating) return;
    let disposed = false;
    foodCellStore.loadManifest().catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [creating]);
  const visible = !creating && enabled && !snapshot.unavailable;
  const area = visible && viewport && viewport.zoom >= FOOD_MIN_ZOOM ? viewport.required : null;
  useEffect(() => {
    if (!area || !snapshot.manifest) return;
    let disposed = false;
    foodCellStore.loadArea(area).catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [area, snapshot.manifest]);
  const places = useMemo(() => visible ? visibleFoodPlaces(snapshot.places, viewport) : [], [visible, snapshot.places, viewport]);
  const relevant = area ? foodCellsFor(snapshot.manifestKeys ?? [], area) : [];
  const error = !snapshot.unavailable && (requestError || snapshot.manifestStatus === "error" || relevant.some(key => snapshot.cellStatus.get(key) === "error"));
  const loading = Boolean(area && (!snapshot.manifest || relevant.some(key => !snapshot.loadedKeys.has(key) && snapshot.cellStatus.get(key) !== "error")));
  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(FOOD_TOGGLE_KEY, next ? "1" : "0"); } catch { /* Keep the in-memory preference. */ }
  }, [enabled]);
  async function retry() {
    setRequestError(false);
    try { await foodCellStore.retry(); if (area) await foodCellStore.loadArea(area); }
    catch { setRequestError(true); }
  }
  return { ...snapshot, enabled, visible, places, hours, onViewport, toggle, error, loading, retry,
    zoomHint: visible && viewport !== null && viewport.zoom < FOOD_MIN_ZOOM };
}
