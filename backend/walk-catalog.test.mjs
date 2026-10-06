import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogMovedShare, catalogWalkView, listedCatalogRoutes } from "./walk-catalog.mjs";

test("catalogue adapter preserves the four published chapters and recordings", () => {
  const route = JSON.parse(readFileSync(new URL("../public/data/routes/paveletskaya.json", import.meta.url), "utf8"));
  const view = catalogWalkView(route);
  assert.deepEqual(view.chapters.map(chapter => chapter.id), route.walk.steps.map(step => step.id));
  assert.deepEqual(view.chapters.map(chapter => chapter.audio?.url), route.walk.steps.map(step => step.audio.url));
  assert.equal(view.document.route.geometry.length, route.walk.path.coordinates.length);
  assert.ok(view.chapters.every(chapter => chapter.story?.sources.length));
  // Annotated once against Valhalla trace_attributes (docs/agents/route-tunnels.md).
  assert.deepEqual(view.document.route.tunnels, [[29, 30]]);
  const plain = structuredClone(route); delete plain.walk.path.tunnels;
  assert.equal("tunnels" in catalogWalkView(plain).document.route, false);
});

const SHARE = "901d1133-44a2-4724-a856-2fe8d6c86a44";
test("a catalogue walk moved to a shared walk is named by its share token", () => {
  for (const [moved, expected] of [[SHARE, SHARE], [undefined, null], ["", null], ["not-a-token", null], [SHARE.toUpperCase(), null], [42, null]])
    assert.equal(catalogMovedShare({ id: "walk", moved_to_share: moved }), expected, String(moved));
});

test("listed catalogue walks skip moved walks and walks without steps", () => {
  const steps = { walk: { steps: [{ id: "a" }] } };
  const routes = [{ id: "listed", ...steps }, { id: "moved", ...steps, moved_to_share: SHARE }, { id: "empty", walk: { steps: [] } }, { id: "plain" }];
  assert.deepEqual(listedCatalogRoutes(routes).map(route => route.id), ["listed"]);
});
