"use client";

import { useEffect, useState } from "react";
import type { Route } from "./types";
import { routeToWalkView } from "../walks/adapters";
import { loadCatalogWalk } from "../walks/walk-loader";
import type { WalkView } from "../walks/model";
import { TourExperience } from "./tour-experience";

export function CatalogTour({ route }: { route: Route }) {
  const [view, setView] = useState<WalkView>(() => routeToWalkView(route));
  useEffect(() => {
    const controller = new AbortController();
    void loadCatalogWalk(route.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setView(value);
    }).catch(() => {
      // The bundled route remains a complete offline fallback.
    });
    return () => controller.abort();
  }, [route]);
  return <TourExperience walk={view} />;
}
