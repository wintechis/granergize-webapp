/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DEFAULT_VIEW,
  type ObsView,
  resolveView,
  showsMetric,
  showsYearSlider,
  viewToParams,
} from "./observationsAxes.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveView: empty / unknown → the default (list)", () => {
  assert.equal(resolveView(p("")), DEFAULT_VIEW);
  assert.equal(resolveView(p("view=zzz")), "list");
});

Deno.test("resolveView: each known view passes through", () => {
  for (const v of ["list", "map", "overtime", "overyears"] as ObsView[]) {
    assert.equal(resolveView(p(`view=${v}`)), v);
  }
});

Deno.test("viewToParams: omits the default, sets the rest, preserves energy/viewport/pager", () => {
  const prev = p("m=heat&y=2023&c=51,10&z=6&offset=20");
  const out = viewToParams("overtime", prev);
  assert.equal(out.get("view"), "overtime");
  assert.equal(out.get("m"), "heat", "metric survives");
  assert.equal(out.get("y"), "2023", "year survives");
  assert.equal(out.get("c"), "51,10", "viewport survives");
  assert.equal(out.get("offset"), "20", "pager survives");
  // the default view writes a clean URL (no ?view)
  assert.equal(viewToParams("list", p("m=heat")).get("view"), null);
  assert.equal(viewToParams("list", p("m=heat")).get("m"), "heat");
  // …and the map, no longer the default, now has to be written explicitly — a bare
  // `/observations` means the List.
  assert.equal(viewToParams("map", p("m=heat")).get("view"), "map");
});

Deno.test("showsMetric: everything but the plain List", () => {
  assert.equal(showsMetric("list"), false);
  assert.equal(showsMetric("map"), true);
  assert.equal(showsMetric("overtime"), true);
  assert.equal(showsMetric("overyears"), true);
});

Deno.test("showsYearSlider: only the map (heatmap + over-years span all years)", () => {
  assert.equal(showsYearSlider("map"), true);
  assert.equal(showsYearSlider("overtime"), false);
  assert.equal(showsYearSlider("overyears"), false);
  assert.equal(showsYearSlider("list"), false);
});
