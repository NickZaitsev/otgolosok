import type { FoodPlace } from "../food/types";
import { accountApi, getSession } from "../auth/client";
import { isPlan } from "../walk-builder/model";
import { playbackStorageKey } from "@/lib/audio/playback-progress";
import { FoodStopError, foodLegRequest, foodStopLeg, insertFoodStop, viewWithDocument } from "./food-stop";
import { saveLocalWalk } from "./local-store";
import { loadJson, WalkLoadError } from "./walk-loader";
import { validateWalkDocument, type WalkDocument, type WalkView } from "./model";

/** Where the open walk lives: the viewer's own walks are changed in place, the others are copied. */
export type FoodStopSource = { kind: "local" | "id" | "catalog" | "share"; id: string };
/** The changed walk; `moved` names the copy when the walk was not the viewer's own. */
export type FoodStopResult = { view: WalkView; moved: { kind: "local" | "id"; id: string } | null };

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type Deps = {
  plan: (request: NonNullable<ReturnType<typeof foodLegRequest>>, signal: AbortSignal) => Promise<unknown>;
  account: (path: string, init: RequestInit) => Promise<unknown>;
  session: () => Promise<{ id: string } | null>;
  storage: StoragePort;
  newId: () => string;
};

const defaults = (): Deps => ({
  // The planner only reads the router, so transient failures (429, 5xx, network) are retried.
  plan: (request, signal) => loadJson("/api/walk-plan", signal, value => value, 3, request),
  account: accountApi,
  session: getSession,
  storage: localStorage,
  newId: () => crypto.randomUUID(),
});

function savedWalk(value: unknown): { id: string; revision: number } {
  const walk = (value as { walk?: { id?: unknown; revision?: unknown } } | null)?.walk;
  if (typeof walk?.id !== "string" || !Number.isSafeInteger(walk.revision)) throw new Error("Сервис вернул некорректный ответ. Обновите страницу.");
  return { id: walk.id, revision: walk.revision as number };
}

/** The copy keeps the walker's direction and the place in the story they were listening to. */
function carryOver(storage: StoragePort, from: string, to: string) {
  try {
    const direction = storage.getItem(`otgolosok:walk-direction:${from}`);
    if (direction !== null) storage.setItem(`otgolosok:walk-direction:${to}`, direction);
    for (const suffix of ["", ":reverse"]) {
      const raw = storage.getItem(playbackStorageKey(from) + suffix);
      if (raw === null) continue;
      const checkpoint = JSON.parse(raw) as Record<string, unknown>;
      if (checkpoint?.routeId === from) storage.setItem(playbackStorageKey(to) + suffix, JSON.stringify({ ...checkpoint, routeId: to }));
    }
  } catch { /* Without storage the copy starts from the beginning, as any new walk. */ }
}

/** Routes the way through the venue between its neighbouring stops and saves the walk with it. */
export async function addFoodStop(view: WalkView, source: FoodStopSource, place: FoodPlace, signal: AbortSignal, deps: Deps = defaults()): Promise<FoodStopResult> {
  const leg = foodStopLeg(view.document, place);
  const request = foodLegRequest(leg, place);
  let plan = null;
  if (request) {
    const value = await deps.plan(request, signal).catch((error: unknown) => {
      // The planner's own words speak of a whole walk; a refused way is about this venue.
      if (error instanceof WalkLoadError && [400, 404].includes(error.status)) throw new FoodStopError("Не получилось проложить пешеходный путь к этому заведению.");
      throw error;
    });
    if (!isPlan(value) || value.stops.length !== 1) throw new Error("Сервис вернул некорректный маршрут. Попробуйте ещё раз.");
    plan = value;
  }
  signal.throwIfAborted();
  const changed = insertFoodStop(view.document, place, leg, plan, deps.newId());
  if (source.kind === "local") {
    const item = saveLocalWalk(deps.storage, changed, view.revision);
    return { view: viewWithDocument(view, item.document, item.revision, `local:${item.revision}`), moved: null };
  }
  if (source.kind === "id") {
    const walk = savedWalk(await deps.account(`/api/me/walks/${encodeURIComponent(source.id)}`, { method: "PATCH", body: JSON.stringify({ title: changed.title, snapshot: changed, revision: view.revision }) }));
    return { view: viewWithDocument(view, changed, walk.revision, `account:${walk.revision}`), moved: null };
  }
  // Someone else's walk stays as published: the walker gets their own copy, in the account when signed in.
  const copy: WalkDocument = validateWalkDocument({ ...changed, id: deps.newId() });
  const user = await deps.session().catch(() => null);
  if (user) {
    const value = await deps.account("/api/me/walks", { method: "POST", body: JSON.stringify({ title: copy.title, snapshot: copy, idempotencyKey: `walk-${copy.id}` }) });
    const walk = savedWalk(value);
    // The server assigns a fresh ID when the document's ID is taken.
    const document = validateWalkDocument({ ...copy, id: walk.id });
    carryOver(deps.storage, view.document.id, walk.id);
    return { view: viewWithDocument(view, document, walk.revision, `account:${walk.revision}`), moved: { kind: "id", id: walk.id } };
  }
  const item = saveLocalWalk(deps.storage, copy, null);
  carryOver(deps.storage, view.document.id, copy.id);
  return { view: viewWithDocument(view, item.document, item.revision, `local:${item.revision}`), moved: { kind: "local", id: copy.id } };
}
