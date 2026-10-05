"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { PLACE_PARAM, readPlaceParam } from "./place-link";

/** The current URL with the place set or removed; other parameters (e.g. `debug`) stay. */
function urlWithPlace(id: string | null): string {
  const rest = new URLSearchParams(location.search);
  rest.delete(PLACE_PARAM);
  // The id is written by hand: URLSearchParams would encode its colons.
  const query = [id ? `${PLACE_PARAM}=${id}` : "", rest.toString()].filter(Boolean).join("&");
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

const shownPlace = () => new URLSearchParams(location.search).get(PLACE_PARAM);

/**
 * The catalog place named by the URL (`/?place=<id>`) and the only ways to change it.
 *
 * The URL changes through the native History API only: Next 16 patches pushState/replaceState so that
 * useSearchParams follows without a navigation, a server request or a reload. The state is always a fresh object
 * without Next's keys: Next copies its `__NA` marker and tree into it (an entry without `__NA` would make Next's
 * popstate handler reload the page), while data that already carries `__NA` is passed through and the router never
 * sees the new URL. Never use the router or `location` here.
 */
export function usePlaceUrl() {
  const link = readPlaceParam(useSearchParams());
  const urlPlace = link && "id" in link ? link.id : null;
  const invalid = link !== null && "invalid" in link;

  /** Every opened place is a history step; the place already shown adds none. */
  const openPlace = useCallback((id: string) => {
    if (shownPlace() === id) return;
    history.pushState({}, "", urlWithPlace(id));
  }, []);

  /**
   * The place card goes away: a new step without a place, so Back brings the card back. `replace` rewrites the
   * current entry instead (an expanded card's entry, a damaged or unpublished link).
   */
  const leavePlace = useCallback(({ replace = false }: { replace?: boolean } = {}) => {
    if (shownPlace() === null) return;
    if (replace) history.replaceState({}, "", urlWithPlace(null));
    else history.pushState({}, "", urlWithPlace(null));
  }, []);

  /** Rewrites the current entry with an exact URL (leaving the walk builder). */
  const replaceUrl = useCallback((url: string) => { history.replaceState({}, "", url); }, []);

  return { urlPlace, invalid, openPlace, leavePlace, replaceUrl };
}
