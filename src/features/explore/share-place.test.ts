import { expect, it, vi } from "vitest";
import { sharePlace, type ShareEnvironment } from "./share-place";

const place = { title: "Дом Пашкова", url: "https://otgolosok.online/place/way/1" };
const named = (name: string) => Object.assign(new Error(name), { name });

it.each<{ case: string; env: () => ShareEnvironment; outcome: string; copied: boolean }>([
  { case: "the share sheet takes the link", env: () => ({ share: vi.fn(async () => {}), writeText: vi.fn(async () => {}) }), outcome: "shared", copied: false },
  { case: "the user closes the share sheet", env: () => ({ share: vi.fn(async () => { throw named("AbortError"); }), writeText: vi.fn(async () => {}) }), outcome: "cancelled", copied: false },
  { case: "sharing is refused", env: () => ({ share: vi.fn(async () => { throw named("NotAllowedError"); }), writeText: vi.fn(async () => {}) }), outcome: "copied", copied: true },
  { case: "the payload cannot be shared", env: () => ({ share: vi.fn(async () => {}), canShare: () => false, writeText: vi.fn(async () => {}) }), outcome: "copied", copied: true },
  { case: "there is no share sheet", env: () => ({ writeText: vi.fn(async () => {}) }), outcome: "copied", copied: true },
  { case: "the clipboard refuses", env: () => ({ writeText: vi.fn(async () => { throw named("NotAllowedError"); }) }), outcome: "manual", copied: true },
  { case: "there is no clipboard either", env: () => ({}), outcome: "manual", copied: false },
])("$case → $outcome", async ({ env, outcome, copied }) => {
  const environment = env();
  expect(await sharePlace(place, environment)).toBe(outcome);
  if (copied) expect(environment.writeText).toHaveBeenCalledWith(place.url);
  else if (environment.writeText) expect(environment.writeText).not.toHaveBeenCalled();
});

it("shares the title in the text and the shared link as the URL", async () => {
  const share = vi.fn(async (data: ShareData) => { void data; });
  await sharePlace(place, { share });
  expect(share).toHaveBeenCalledWith({ title: "Дом Пашкова", text: "Дом Пашкова — история в «Отголоске»", url: place.url });
});
