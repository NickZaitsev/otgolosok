import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { MapViewport } from "./catalog-bounds";
import { intersects, WALK_OVERVIEW_TOGGLE_KEY, walkOverviewStore, type WalkOverviewStore } from "./walk-overview";

/** The «Прогулки на карте» layer of the nearby screen: its switch, the walks of the view and the loading state. */
export function useWalkOverview(creating: boolean, store: WalkOverviewStore = walkOverviewStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [enabled, setEnabled] = useState(false);
  const [viewport, onViewport] = useState<MapViewport | null>(null);
  useEffect(() => {
    // Read after hydration: the static page is rendered without the preference.
    const timer = setTimeout(() => {
      try { setEnabled(localStorage.getItem(WALK_OVERVIEW_TOGGLE_KEY) === "1"); } catch { /* Storage is optional. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const visible = !creating && enabled && !snapshot.unavailable;
  useEffect(() => {
    if (visible && viewport) void store.ensure(viewport);
  }, [visible, viewport, store]);
  useEffect(() => { if (!visible) store.cancel(); }, [visible, store]);
  // Lines are drawn for the doubled area too, so a pan does not uncover a walk that is already loaded.
  const walks = useMemo(() => {
    if (!visible || !viewport) return [];
    const { west, east, south, north } = viewport.buffered;
    return snapshot.walks.filter(walk => intersects(walk.bounds, { west, east, south, north }));
  }, [visible, viewport, snapshot.walks]);
  // Walks crossing the visible view, in ranking order: the keyboard list offers these.
  const inView = useMemo(() => !viewport ? [] : walks.filter(walk => intersects(walk.bounds, viewport.required)), [walks, viewport]);
  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(WALK_OVERVIEW_TOGGLE_KEY, next ? "1" : "0"); } catch { /* Keep the in-memory preference. */ }
  }, [enabled]);
  const retry = useCallback(() => { void store.retry(); }, [store]);
  return { enabled, visible, walks, inView, unavailable: snapshot.unavailable, onViewport, toggle, retry,
    loading: visible && snapshot.status === "loading", error: visible && snapshot.status === "error" };
}
