/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  type CubeAxes,
  DEFAULT_AXES,
  pickRenderer,
  resolveAxes,
  showsMetric,
  showsYearSlider,
  toParams,
} from "./exploreAxes.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveAxes: empty URL → the default (geographic ownership map)", () => {
  assert.deepEqual(resolveAxes(p("")), DEFAULT_AXES);
});

Deno.test("resolveAxes: explicit params pass through; unknowns fall back", () => {
  assert.deepEqual(resolveAxes(p("space=rows&colour=energy")), {
    space: "rows",
    colour: "energy",
  });
  assert.deepEqual(resolveAxes(p("space=zzz&colour=zzz")), DEFAULT_AXES);
});

Deno.test("resolveAxes: legacy ?view=list → rows + ownership (the List)", () => {
  assert.deepEqual(resolveAxes(p("view=list")), { space: "rows", colour: "ownership" });
});

Deno.test("resolveAxes: legacy ?explore=matrix/compare → rows + energy (the heatmap)", () => {
  assert.deepEqual(resolveAxes(p("explore=matrix")), { space: "rows", colour: "energy" });
  assert.deepEqual(resolveAxes(p("explore=compare")), { space: "rows", colour: "energy" });
});

Deno.test("resolveAxes: new params win over legacy", () => {
  assert.deepEqual(resolveAxes(p("view=list&space=map")), DEFAULT_AXES);
});

Deno.test("pickRenderer: the four views map to three renderers", () => {
  assert.equal(pickRenderer({ space: "map", colour: "ownership" }), "map");
  assert.equal(pickRenderer({ space: "map", colour: "energy" }), "map");
  assert.equal(pickRenderer({ space: "rows", colour: "ownership" }), "list");
  assert.equal(pickRenderer({ space: "rows", colour: "energy" }), "matrix");
});

Deno.test("showsMetric / showsYearSlider follow the colour + space", () => {
  const mapOwn: CubeAxes = { space: "map", colour: "ownership" };
  const mapEnergy: CubeAxes = { space: "map", colour: "energy" };
  const rowsEnergy: CubeAxes = { space: "rows", colour: "energy" };

  assert.equal(showsMetric(mapOwn), false);
  assert.equal(showsMetric(mapEnergy), true);
  assert.equal(showsMetric(rowsEnergy), true);

  assert.equal(showsYearSlider(mapEnergy), true);
  assert.equal(showsYearSlider(rowsEnergy), false, "the heatmap shows all years");
  assert.equal(showsYearSlider(mapOwn), false);
});

Deno.test("toParams: omits defaults, clears legacy, preserves the rest", () => {
  const prev = p("m=heat&y=2023&view=list&explore=matrix&c=51,10&z=6");
  const out = toParams({ space: "rows", colour: "energy" }, prev);
  assert.equal(out.get("space"), "rows");
  assert.equal(out.get("colour"), "energy");
  assert.equal(out.get("view"), null, "legacy ?view cleared");
  assert.equal(out.get("explore"), null, "legacy ?explore cleared");
  assert.equal(out.get("m"), "heat", "unrelated params survive");
  assert.equal(out.get("y"), "2023");
  assert.equal(out.get("c"), "51,10");

  // the default pair writes a clean URL (no axis params)
  const clean = toParams(DEFAULT_AXES, p("m=heat"));
  assert.equal(clean.get("space"), null);
  assert.equal(clean.get("colour"), null);
  assert.equal(clean.get("m"), "heat");
});
