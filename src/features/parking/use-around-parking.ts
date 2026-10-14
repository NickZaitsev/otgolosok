"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { MapViewport } from "../explore/catalog-bounds";
import { useTravelSettings } from "../travel/settings";
import { parkingCellStore, parkingCellsFor } from "./parking-cells";

export const PARKING_TOGGLE_KEY = "otgolosok:parking-layer";
export const PARKING_MIN_ZOOM = 14;

export function useAroundParking(creating: boolean, creationDriving: boolean) {
  const snapshot = useSyncExternalStore(parkingCellStore.subscribe, parkingCellStore.snapshot, parkingCellStore.snapshot);
  const { travelMode } = useTravelSettings();
  const [explicit, setExplicit] = useState<boolean | null>(null);
  const [viewport, onViewport] = useState<MapViewport | null>(null);
  const [requestError, setRequestError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setExplicit(localStorage.getItem(PARKING_TOGGLE_KEY) === "1" ? true : localStorage.getItem(PARKING_TOGGLE_KEY) === "0" ? false : null); }
      catch { setExplicit(null); }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const enabled = explicit ?? travelMode === "driving";
  const wanted = creationDriving || (!creating && enabled);
  useEffect(() => {
    if (!wanted) return;
    let disposed = false;
    parkingCellStore.loadManifest().catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [wanted]);
  const area = wanted && viewport && viewport.zoom >= PARKING_MIN_ZOOM ? viewport.required : null;
  useEffect(() => {
    if (!area || !snapshot.manifest) return;
    let disposed = false;
    parkingCellStore.loadArea(area).catch(() => { if (!disposed) setRequestError(true); });
    return () => { disposed = true; };
  }, [area, snapshot.manifest]);
  const places = useMemo(() => !wanted || !viewport || viewport.zoom < PARKING_MIN_ZOOM ? [] : snapshot.places.filter(place => place.location.lat >= viewport.required.south && place.location.lat <= viewport.required.north && place.location.lon >= viewport.required.west && place.location.lon <= viewport.required.east), [wanted, viewport, snapshot.places]);
  const relevant = area ? parkingCellsFor(snapshot.manifestKeys ?? [], area, snapshot.manifest?.cellSize) : [];
  const error = wanted && !snapshot.unavailable && (requestError || snapshot.manifestStatus === "error" || relevant.some(key => snapshot.cellStatus.get(key) === "error"));
  const loading = Boolean(!error && !snapshot.unavailable && area && (!snapshot.manifest || relevant.some(key => !snapshot.loadedKeys.has(key) && snapshot.cellStatus.get(key) !== "error")));
  const toggle = useCallback(() => setExplicit(current => {
    const next = !(current ?? travelMode === "driving");
    try { localStorage.setItem(PARKING_TOGGLE_KEY, next ? "1" : "0"); } catch { /* The in-memory choice still works. */ }
    return next;
  }), [travelMode]);
  async function retry() { setRequestError(false); try { await parkingCellStore.retry(...(area ? [area] : [])); } catch { setRequestError(true); } }
  return { ...snapshot, enabled, visible: wanted, places, onViewport, toggle, error, loading, retry,
    zoomHint: wanted && viewport !== null && viewport.zoom < PARKING_MIN_ZOOM };
}
