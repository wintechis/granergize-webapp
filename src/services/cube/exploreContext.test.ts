/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Building } from "../../types.ts";
import {
  EXPLORE_BUILDING_ZOOM,
  exploreBuildingTarget,
  exploreOverTimeTarget,
} from "./exploreContext.ts";
import { resolveIn, resolveRows, resolveView } from "./observationsAxes.ts";

/** A minimal building; the affordance only reads `regionAgs` + the coordinates. */
const b = (extra: Partial<Building> = {}): Building =>
  ({ id: "b1", uri: "b1", type: "Building", ...extra }) as Building;

/** The query string of a built target, as the surface would read it. */
const params = (to: string) => new URLSearchParams(to.split("?")[1] ?? "");

Deno.test("exploreBuildingTarget: an AGS building cuts the pivot to its Gemeinde", () => {
  const { to, viewport } = exploreBuildingTarget(b({ regionAgs: "09564000" }));
  assert.equal(to, "/explore?view=pivot&in=09564000");
  // A pivot target frames no map, so nothing to prime.
  assert.equal(viewport, undefined);
  // The default row level stays OMITTED (it is not session-remembered), and the
  // scope survives the surface's own resolver at that level.
  const sp = params(to);
  assert.equal(sp.has("rows"), false);
  assert.equal(resolveView(sp), "pivot");
  assert.equal(resolveIn(sp, resolveRows(sp)), "09564000");
});

Deno.test("exploreBuildingTarget: a Kreis/Land AGS is a valid scope too", () => {
  assert.equal(
    exploreBuildingTarget(b({ regionAgs: "09564" })).to,
    "/explore?view=pivot&in=09564",
  );
  assert.equal(
    exploreBuildingTarget(b({ regionAgs: "09" })).to,
    "/explore?view=pivot&in=09",
  );
});

Deno.test("exploreBuildingTarget: an unusable AGS falls back to the framed map", () => {
  // Not a ladder prefix (`resolveIn` would drop it) → the map framing instead of a
  // silently unscoped pivot.
  const { to, viewport } = exploreBuildingTarget(
    b({ regionAgs: "0956", lat: 49.4521, long: 11.0767 }),
  );
  assert.equal(to, `/explore?view=map&c=49.45210%2C11.07670&z=${EXPLORE_BUILDING_ZOOM}`);
  assert.deepEqual(viewport, {
    centre: { lat: 49.4521, long: 11.0767 },
    zoom: EXPLORE_BUILDING_ZOOM,
  });
  // `view=map` is pinned even though map is the DEFAULT view — the view axis is
  // session-remembered, so absence would restore whatever was last picked.
  assert.equal(params(to).get("view"), "map");
});

Deno.test("exploreBuildingTarget: no region, no coordinates → the plain map", () => {
  const { to, viewport } = exploreBuildingTarget(b());
  assert.equal(to, "/explore?view=map");
  assert.equal(viewport, undefined);
});

Deno.test("exploreOverTimeTarget: the heatmap, carrying a measure only when held", () => {
  assert.equal(exploreOverTimeTarget().to, "/explore?view=overtime");
  assert.equal(
    exploreOverTimeTarget("heatConsumption").to,
    "/explore?view=overtime&m=heatConsumption",
  );
  assert.equal(resolveView(params(exploreOverTimeTarget().to)), "overtime");
});
