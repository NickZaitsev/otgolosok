import type { Route } from "./types";

export type WalkDirection = "forward" | "reverse";

/** Reuse the checked pedestrian path and recordings without changing the published walk. */
export function orientWalk(route: Route, direction: WalkDirection): Route {
  if (direction === "forward" || !route.walk) return route;
  const walk = route.walk;
  const last = walk.path.coordinates.length - 1;
  return {
    ...route,
    walk: {
      ...walk,
      start: walk.finish,
      finish: walk.start,
      steps: [...walk.steps].reverse().map(step => ({ ...step, transition: "", next_hint: "" })),
      path: {
        ...walk.path,
        coordinates: [...walk.path.coordinates].reverse(),
        ...(walk.path.tunnels ? { tunnels: [...walk.path.tunnels].reverse().map(([a, b]): [number, number] => [last - b, last - a]) } : {}),
      },
    },
  };
}
