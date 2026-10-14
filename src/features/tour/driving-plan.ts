import type { Coordinates } from "./types";

export type DrivingParking = {
  id: string;
  name: string;
  location: Coordinates;
  entrance: Coordinates;
  exit: Coordinates;
  pedestrianAccess: Coordinates;
  access: "public" | "unknown";
  fee: boolean | null;
  openingHours: string | null;
};

export type DrivingVisit = {
  id: string;
  parking: DrivingParking;
  stopIds: string[];
  visitMinutes: number;
  parkingMinutes: number;
};

export type DrivingSegment = {
  mode: "driving" | "walking";
  visitId: string | null;
  geometry: Coordinates[];
  distanceM: number;
  minutes: number;
};

export type DrivingRoute = {
  drivingMinutes: number;
  totalMinutes: number;
  visits: DrivingVisit[];
  segments: DrivingSegment[];
};

export type DrivingPlanState =
  | { phase: "overview" }
  | { phase: "driving"; visitIndex: number }
  | { phase: "visiting"; visitIndex: number; storyIndex: number }
  | { phase: "returning"; visitIndex: number }
  | { phase: "finishing" }
  | { phase: "complete" };

export type DrivingPlanAction =
  | { type: "start" }
  | { type: "parked" }
  | { type: "next-story" }
  | { type: "return-to-car" }
  | { type: "at-car" }
  | { type: "finish-reached" }
  | { type: "restart" };

export type DrivingPlanOptions = { finishRequired: boolean };

export const initialDrivingPlanState = (): DrivingPlanState => ({ phase: "overview" });

function afterLastVisit(options: DrivingPlanOptions): DrivingPlanState {
  return options.finishRequired ? { phase: "finishing" } : { phase: "complete" };
}

/** One explicit action advances one real-world handoff; no GPS arrival starts a story. */
export function advanceDrivingPlan(
  state: DrivingPlanState,
  action: DrivingPlanAction,
  route: DrivingRoute,
  options: DrivingPlanOptions,
): DrivingPlanState {
  if (action.type === "restart") return initialDrivingPlanState();
  if (state.phase === "overview" && action.type === "start") {
    return route.visits.length ? { phase: "driving", visitIndex: 0 } : afterLastVisit(options);
  }
  if (state.phase === "driving" && action.type === "parked") {
    const visit = route.visits[state.visitIndex];
    if (!visit) return initialDrivingPlanState();
    return visit.stopIds.length
      ? { phase: "visiting", visitIndex: state.visitIndex, storyIndex: 0 }
      : { phase: "returning", visitIndex: state.visitIndex };
  }
  if (state.phase === "visiting" && action.type === "next-story") {
    const visit = route.visits[state.visitIndex];
    if (visit && state.storyIndex + 1 < visit.stopIds.length) {
      return { ...state, storyIndex: state.storyIndex + 1 };
    }
  }
  if (state.phase === "visiting" && action.type === "return-to-car") {
    return { phase: "returning", visitIndex: state.visitIndex };
  }
  if (state.phase === "returning" && action.type === "at-car") {
    const next = state.visitIndex + 1;
    return next < route.visits.length ? { phase: "driving", visitIndex: next } : afterLastVisit(options);
  }
  if (state.phase === "finishing" && action.type === "finish-reached") return { phase: "complete" };
  return state;
}

export function drivingAudioAllowed(state: DrivingPlanState) {
  return state.phase === "visiting";
}

export function currentDrivingVisit(state: DrivingPlanState, route: DrivingRoute): DrivingVisit | null {
  return "visitIndex" in state ? route.visits[state.visitIndex] ?? null : null;
}

export function currentDrivingStopId(state: DrivingPlanState, route: DrivingRoute): string | null {
  if (state.phase !== "visiting") return null;
  return route.visits[state.visitIndex]?.stopIds[state.storyIndex] ?? null;
}

export function visitStoryGroups(route: DrivingRoute, knownStopIds: ReadonlySet<string>) {
  return route.visits.map(visit => ({
    visitId: visit.id,
    stopIds: visit.stopIds.filter((id, index, ids) => knownStopIds.has(id) && ids.indexOf(id) === index),
  }));
}

type ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SavedProgress = { version: 1; revision: number; state: DrivingPlanState };

export function drivingProgressKey(documentId: string) {
  return `otgolosok:driving-progress:v1:${documentId}`;
}

export function saveDrivingProgress(storage: ProgressStorage, documentId: string, revision: number, state: DrivingPlanState) {
  try {
    storage.setItem(drivingProgressKey(documentId), JSON.stringify({ version: 1, revision, state } satisfies SavedProgress));
  } catch {
    // Private mode and full storage must not interrupt a trip.
  }
}

export function clearDrivingProgress(storage: ProgressStorage, documentId: string) {
  try {
    storage.removeItem(drivingProgressKey(documentId));
  } catch {
    // The completed state still remains on screen when storage is unavailable.
  }
}

function validState(state: unknown, route: DrivingRoute, options: DrivingPlanOptions): state is DrivingPlanState {
  if (!state || typeof state !== "object") return false;
  const candidate = state as Record<string, unknown>;
  if (candidate.phase === "overview" || candidate.phase === "complete") return true;
  if (candidate.phase === "finishing") return options.finishRequired;
  if (!Number.isInteger(candidate.visitIndex) || (candidate.visitIndex as number) < 0 || (candidate.visitIndex as number) >= route.visits.length) return false;
  if (candidate.phase === "driving" || candidate.phase === "returning") return true;
  if (candidate.phase !== "visiting" || !Number.isInteger(candidate.storyIndex)) return false;
  const stories = route.visits[candidate.visitIndex as number]?.stopIds.length ?? 0;
  return (candidate.storyIndex as number) >= 0 && (candidate.storyIndex as number) < stories;
}

export function loadDrivingProgress(
  storage: ProgressStorage,
  documentId: string,
  revision: number,
  route: DrivingRoute,
  options: DrivingPlanOptions,
): DrivingPlanState {
  try {
    const raw = storage.getItem(drivingProgressKey(documentId));
    if (!raw) return initialDrivingPlanState();
    const saved = JSON.parse(raw) as Partial<SavedProgress>;
    return saved.version === 1 && saved.revision === revision && validState(saved.state, route, options)
      ? saved.state
      : initialDrivingPlanState();
  } catch {
    return initialDrivingPlanState();
  }
}
