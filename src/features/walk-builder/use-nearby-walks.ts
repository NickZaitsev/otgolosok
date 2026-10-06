"use client";

import { useEffect, useMemo, useState } from "react";
import type { Coordinates } from "../tour/types";
import { listLocalWalks, type LocalWalkItem } from "../walks/local-store";
import { loadJson } from "../walks/walk-loader";
import { localNearbyWalks, mergeNearby, validateNearbyWalks, type EditingWalk, type NearbyWalk } from "../walks/nearby-model";

const coordinate = (value: number) => value.toFixed(5);

/** Walks of this browser; damaged storage gives none because the builder reports storage errors itself. */
function readLocalWalks(): LocalWalkItem[] {
  try { return listLocalWalks(localStorage); } catch { return []; }
}

/**
 * Ready walks that start near `start`, for the creation sheet. The suggestion is optional:
 * a failed request falls back to this browser's walks without an error.
 */
export function useNearbyWalks(start: Coordinates | null, exclude: EditingWalk | null, enabled: boolean): NearbyWalk[] {
  const lat = enabled && start ? coordinate(start.lat) : null, lon = enabled && start ? coordinate(start.lon) : null;
  const query = lat !== null && lon !== null ? `lat=${lat}&lon=${lon}` : null;
  const [server, setServer] = useState<{ query: string; walks: NearbyWalk[] } | null>(null);
  const [local, setLocal] = useState<{ query: string; items: LocalWalkItem[] } | null>(null);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    // Browser storage is read after mount, together with the request, so hydration stays stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal({ query, items: readLocalWalks() });
    loadJson(`/api/walks/nearby?${query}`, controller.signal, validateNearbyWalks)
      .then(walks => setServer({ query, walks }))
      .catch(() => { if (!controller.signal.aborted) setServer({ query, walks: [] }); });
    return () => controller.abort();
  }, [query]);
  const excludeKind = exclude?.kind ?? null, excludeId = exclude?.id ?? null;
  return useMemo(() => {
    if (!query) return [];
    const point = { lat: Number(lat), lon: Number(lon) };
    const editing = excludeKind && excludeId ? { kind: excludeKind, id: excludeId } : null;
    // Until the server answers for this start, nothing is shown, so cards never jump in order.
    if (server?.query !== query) return [];
    const items = local?.query === query ? local.items : [];
    return mergeNearby(server.walks, localNearbyWalks(items, point, editing?.kind === "local" ? editing.id : null), editing);
  }, [query, lat, lon, server, local, excludeKind, excludeId]);
}
