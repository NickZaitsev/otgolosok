import { copyCarRoute } from "../../../backend/car-route.mjs";
import { cityAtPoint } from "../city/current-city";
import { isPlanIn } from "../walk-builder/model";
import { request } from "../walk-builder/request";
import { saveLocalWalk } from "./local-store";
import { validateWalkDocument, type WalkDocument, type WalkView } from "./model";

/** A new local document preserves source story references; the published walk stays intact. */
export function carCopyDocument(view: WalkView, plan: unknown, id: string): WalkDocument {
  const source = view.sourceDocument ?? view.document;
  if (!source.start || !source.route || source.travelMode === "driving" || !source.stops.length
    || !isPlanIn(plan, point => cityAtPoint(point)?.name === source.city) || !plan.car
    || plan.stops.length !== source.stops.length || plan.car.totalMinutes > 180
    || plan.stops.some((stop, index) => stop.stopId !== source.stops[index].id
      || stop.location.lat !== source.stops[index].place.location.lat || stop.location.lon !== source.stops[index].place.location.lon)) {
    throw new Error("Не удалось сохранить все остановки автомобильной прогулки. Выберите другой маршрут.");
  }
  return validateWalkDocument({ ...structuredClone(source), id, travelMode: "driving", minutes: 180,
    route: { geometry: plan.geometry, distanceM: plan.distanceM, walkingMinutes: plan.walkingMinutes,
      attribution: plan.attribution, car: copyCarRoute(plan.car) },
    // Pedestrian arrival hints are no longer reliable after road routing.
    stops: source.stops.map(stop => ({ ...structuredClone(stop), transition: "", nextHint: "" })), fieldChecked: false });
}

export async function createCarCopy(view: WalkView, signal: AbortSignal, deps = {
  plan: request, storage: () => localStorage, newId: () => crypto.randomUUID(),
}) {
  const source = view.sourceDocument ?? view.document;
  if (!source.start || !source.route || !source.stops.length || source.travelMode === "driving") throw new Error("Для этой прогулки нельзя построить автомобильный маршрут.");
  const plan = await deps.plan("/api/walk-plan", signal, { travelMode: "driving", start: source.start,
    mode: source.mode, minutes: 180, ...(source.destination ? { destination: source.destination } : {}),
    stops: source.stops.map(stop => ({ ...stop.place, stopId: stop.id })) });
  signal.throwIfAborted();
  const document = carCopyDocument(view, plan, deps.newId());
  return saveLocalWalk(deps.storage(), document, null).document.id;
}
