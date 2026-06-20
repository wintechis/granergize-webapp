/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  axisOptions,
  type CubeAxes,
  DEFAULT_AXES,
  nextAxes,
  pickRenderer,
  resolveAxes,
  toParams,
} from "./exploreAxes.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveAxes: empty URL → the default (geographic ownership map)", () => {
  assert.deepEqual(resolveAxes(p(""), 5), DEFAULT_AXES);
});

Deno.test("resolveAxes: explicit new params pass through", () => {
  assert.deepEqual(resolveAxes(p("space=rows&time=over&colour=value"), 5), {
    space: "rows",
    time: "over",
    colour: "value",
  });
});

Deno.test("resolveAxes: unknown values fall back to defaults", () => {
  assert.deepEqual(resolveAxes(p("space=zzz&time=zzz&colour=zzz"), 5), DEFAULT_AXES);
});

Deno.test("resolveAxes: legacy ?view=list → rows + ownership (the List)", () => {
  assert.deepEqual(resolveAxes(p("view=list"), 5), {
    space: "rows",
    time: "one",
    colour: "ownership",
  });
});

Deno.test("resolveAxes: legacy ?explore=matrix/compare → rows + value + that time", () => {
  assert.deepEqual(resolveAxes(p("explore=matrix"), 5), {
    space: "rows",
    time: "over",
    colour: "value",
  });
  assert.deepEqual(resolveAxes(p("explore=compare"), 5), {
    space: "rows",
    time: "compare",
    colour: "value",
  });
});

Deno.test("resolveAxes: new params win over legacy", () => {
  assert.deepEqual(resolveAxes(p("view=list&space=map"), 5), DEFAULT_AXES);
});

Deno.test("resolveAxes: space=map forces time=one (a map is one cross-section)", () => {
  assert.equal(resolveAxes(p("space=map&time=over"), 5).time, "one");
});

Deno.test("resolveAxes: colour=trend falls back when <2 years", () => {
  assert.equal(resolveAxes(p("space=rows&time=over&colour=trend"), 1).colour, "value");
  assert.equal(resolveAxes(p("space=map&colour=trend"), 0).colour, "ownership");
  // ≥2 years keeps trend
  assert.equal(resolveAxes(p("space=map&colour=trend"), 3).colour, "trend");
});

Deno.test("nextAxes: choosing a multi-year time pulls Space→rows + a measure", () => {
  const from: CubeAxes = { space: "map", time: "one", colour: "ownership" };
  assert.deepEqual(nextAxes(from, { time: "over" }, 5), {
    space: "rows",
    time: "over",
    colour: "value",
  });
  assert.deepEqual(nextAxes(from, { time: "compare" }, 5), {
    space: "rows",
    time: "compare",
    colour: "value",
  });
});

Deno.test("nextAxes: choosing Space=map forces time back to one", () => {
  const from: CubeAxes = { space: "rows", time: "over", colour: "value" };
  assert.deepEqual(nextAxes(from, { space: "map" }, 5), {
    space: "map",
    time: "one",
    colour: "value",
  });
});

Deno.test("nextAxes: a measure colour on rows+one lands on the over-time grid", () => {
  const from: CubeAxes = { space: "rows", time: "one", colour: "ownership" };
  assert.deepEqual(nextAxes(from, { colour: "value" }, 5), {
    space: "rows",
    time: "over",
    colour: "value",
  });
});

Deno.test("nextAxes: switching colour back to ownership on rows keeps the List", () => {
  const from: CubeAxes = { space: "rows", time: "over", colour: "value" };
  assert.deepEqual(nextAxes(from, { colour: "ownership" }, 5), {
    space: "rows",
    time: "over",
    colour: "ownership",
  });
  assert.equal(pickRenderer(nextAxes(from, { colour: "ownership" }, 5)), "list");
});

Deno.test("pickRenderer: every shipped view maps; the rest are disabled", () => {
  assert.equal(pickRenderer({ space: "map", time: "one", colour: "ownership" }), "map");
  assert.equal(pickRenderer({ space: "map", time: "one", colour: "value" }), "map");
  assert.equal(pickRenderer({ space: "map", time: "one", colour: "trend" }), "map");
  assert.equal(pickRenderer({ space: "rows", time: "one", colour: "ownership" }), "list");
  assert.equal(pickRenderer({ space: "rows", time: "over", colour: "value" }), "matrix");
  assert.equal(pickRenderer({ space: "rows", time: "compare", colour: "value" }), "compare");
  // not shipped in v1
  assert.equal(pickRenderer({ space: "rows", time: "one", colour: "value" }), "disabled");
  assert.equal(pickRenderer({ space: "rows", time: "over", colour: "trend" }), "disabled");
});

Deno.test("toParams: omits defaults, clears legacy params, preserves the rest", () => {
  const prev = p("m=heat&y=2023&view=list&explore=matrix&c=51,10&z=6");
  const out = toParams({ space: "rows", time: "over", colour: "value" }, prev);
  assert.equal(out.get("space"), "rows");
  assert.equal(out.get("time"), "over");
  assert.equal(out.get("colour"), "value");
  assert.equal(out.get("view"), null, "legacy ?view cleared");
  assert.equal(out.get("explore"), null, "legacy ?explore cleared");
  assert.equal(out.get("m"), "heat", "unrelated params survive");
  assert.equal(out.get("y"), "2023");
  assert.equal(out.get("c"), "51,10");

  // the default triple writes a clean URL (no axis params)
  const clean = toParams(DEFAULT_AXES, p("m=heat"));
  assert.equal(clean.get("space"), null);
  assert.equal(clean.get("time"), null);
  assert.equal(clean.get("colour"), null);
  assert.equal(clean.get("m"), "heat");
});

Deno.test("axisOptions: time greyed on the map + under ownership; trend needs 2 years", () => {
  const onMap = axisOptions({ space: "map", time: "one", colour: "value" }, 5);
  assert.equal(onMap.timeDisabled, true);
  assert.equal(onMap.time.over, false);
  assert.equal(onMap.colour.trend, true);

  const rowsValue = axisOptions({ space: "rows", time: "over", colour: "value" }, 5);
  assert.equal(rowsValue.timeDisabled, false);
  assert.equal(rowsValue.time.over, true);

  const rowsOwn = axisOptions({ space: "rows", time: "over", colour: "ownership" }, 5);
  assert.equal(rowsOwn.timeDisabled, true, "ownership collapses time → List");

  const fewYears = axisOptions({ space: "map", time: "one", colour: "ownership" }, 1);
  assert.equal(fewYears.colour.trend, false);
});
