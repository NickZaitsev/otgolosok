import type { Coordinates } from "../tour/types";
import { isMoscowPoint } from "../explore/map-jobs";
import { stageLabels, type GenerationStage } from "../generator/types";

export const DRAFT_KEY = "otgolosok:walk:v1";
export type Place = { address: string; location: Coordinates };
export type Plan = { stops: Place[]; geometry: Coordinates[]; distanceM: number; walkingMinutes: number; attribution: string };
export type StoryRef = { place: Place; id: string; stage: GenerationStage };
export type Draft = {
  version: 1; title: string; start: Place | null; mode: "loop" | "open";
  minutes: 30 | 60 | 90; stops: Place[]; route: Plan | null;
  jobs: StoryRef[]; submitting: Place | null;
};
export const emptyDraft = (): Draft => ({ version: 1, title: "Моя прогулка", start: null, mode: "loop", minutes: 30, stops: [], route: null, jobs: [], submitting: null });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function isPlace(v: unknown): v is Place {
  return record(v) && typeof v.address === "string" && v.address.trim().length >= 6 && v.address.length <= 180 && !/[\p{Cc}\p{Cf}<>]/u.test(v.address) && record(v.location) && typeof v.location.lat === "number" && typeof v.location.lon === "number" && isMoscowPoint(v.location as Coordinates);
}
export const placeKey = (p: Place) => `${p.address.trim().toLocaleLowerCase("ru")}|${p.location.lat}|${p.location.lon}`;
// Match normalizeAddress + the unhashed addressKey input in backend/domain.mjs.
export function storyAddressKey(address: string) {
  const normalized = address.normalize("NFKC").trim().replace(/\s+/g, " ");
  return (/москва/iu.test(normalized) ? normalized : `Москва, ${normalized}`)
    .toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}
export function rememberStory(jobs: StoryRef[], job: StoryRef): StoryRef[] {
  return [...jobs.filter(j => j.id !== job.id), job];
}
export function validStops(start: Place | null, stops: Place[]) {
  if (!start || !isPlace(start) || stops.length < 1 || stops.length > 5 || !stops.every(isPlace)) return false;
  const points = [start, ...stops];
  return points.every((p, i) => points.slice(0, i).every(q => {
    const rad = Math.PI / 180;
    const h = Math.sin((p.location.lat-q.location.lat)*rad/2)**2 + Math.cos(p.location.lat*rad)*Math.cos(q.location.lat*rad)*Math.sin((p.location.lon-q.location.lon)*rad/2)**2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1,h))) >= 25;
  }));
}
export function isPlan(v: unknown): v is Plan {
  return record(v) && Array.isArray(v.stops) && v.stops.length >= 1 && v.stops.length <= 5 && v.stops.every(isPlace) &&
    Array.isArray(v.geometry) && v.geometry.length >= 2 && v.geometry.length <= 12000 && v.geometry.every(p => record(p) && typeof p.lat === "number" && typeof p.lon === "number" && isMoscowPoint(p as Coordinates)) &&
    typeof v.distanceM === "number" && Number.isFinite(v.distanceM) && v.distanceM > 0 && v.distanceM <= 8100 &&
    typeof v.walkingMinutes === "number" && Number.isFinite(v.walkingMinutes) && v.walkingMinutes > 0 && v.walkingMinutes <= 90 && typeof v.attribution === "string" && v.attribution.length > 0 && v.attribution.length <= 2000;
}
export const isJobId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const isStage = (stage: unknown): stage is GenerationStage => typeof stage === "string" && Object.hasOwn(stageLabels, stage);
export function parseDraft(raw: string | null): Draft {
  if (raw === null) return emptyDraft();
  const v: unknown = JSON.parse(raw);
  if (!record(v) || v.version !== 1 || typeof v.title !== "string" || v.title.length > 120 || (v.start !== null && !isPlace(v.start)) || !["loop","open"].includes(String(v.mode)) || ![30,60,90].includes(Number(v.minutes)) || typeof v.minutes !== "number" || !Array.isArray(v.stops) || v.stops.length > 5 || !v.stops.every(isPlace) || !Array.isArray(v.jobs) || v.jobs.length > 100 || !v.jobs.every(j => record(j) && isPlace(j.place) && isJobId(j.id) && isStage(j.stage)) || (v.submitting !== null && !isPlace(v.submitting))) throw new Error("Черновик не удалось прочитать. Исходная копия не изменена.");
  if (v.route !== null && (!isPlan(v.route) || !validStops(v.start as Place | null, v.stops) || JSON.stringify(v.route.stops) !== JSON.stringify(v.stops) || v.route.walkingMinutes > v.minutes)) throw new Error("Сохранённый маршрут повреждён. Исходная копия не изменена.");
  // Older drafts could contain the same backend job for multiple map points.
  return { ...v, jobs: (v.jobs as StoryRef[]).reduce(rememberStory, []) } as Draft;
}
export function editDraft(draft: Draft, change: Partial<Pick<Draft,"start"|"mode"|"minutes"|"stops">>): Draft {
  return { ...draft, ...change, route: null };
}
export function moveStop(stops: Place[], index: number, delta: -1 | 1): Place[] {
  const next = [...stops], target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index],next[target]] = [next[target],next[index]];
  return next;
}
export function saveDraft(storage: Pick<Storage,"getItem"|"setItem">, draft: Draft, previous: string | null) {
  if (storage.getItem(DRAFT_KEY) !== previous) throw new Error("Черновик изменён в другой вкладке. Обновите страницу перед продолжением; эта версия не записана.");
  const raw = JSON.stringify(draft);
  parseDraft(raw);
  storage.setItem(DRAFT_KEY,raw);
  return raw;
}
