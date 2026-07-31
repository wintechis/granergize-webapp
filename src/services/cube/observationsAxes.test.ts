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

Deno.test("resolveView: empty / unknown → the default (map)", () => {
  assert.equal(resolveView(p("")), DEFAULT_VIEW);
  assert.equal(resolveView(p("view=zzz")), "map");
});

Deno.test("resolveView: each known view passes through", () => {
  for (
    const v of [
      "map",
      "list",
      "overtime",
      "overyears",
      "pivot",
      "aggregations",
    ] as ObsView[]
  ) {
    assert.equal(resolveView(p(`view=${v}`)), v);
  }
});

Deno.test("viewToParams: the aggregations projection keeps its guise sub-axis", () => {
  // `?guise=` is the saved-views projection's OWN axis (list / map / timeline); the
  // view switch must not strip it, nor the search/pager/tier facet riding along.
  const out = viewToParams("aggregations", p("guise=map&q=port&offset=20&tiers=open"));
  assert.equal(out.get("view"), "aggregations");
  assert.equal(out.get("guise"), "map");
  assert.equal(out.get("q"), "port");
  assert.equal(out.get("offset"), "20");
  assert.equal(out.get("tiers"), "open");
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
  assert.equal(viewToParams("map", p("m=heat")).get("view"), null);
  assert.equal(viewToParams("map", p("m=heat")).get("m"), "heat");
});

Deno.test("showsMetric: everything but the plain List and the saved views", () => {
  assert.equal(showsMetric("list"), false);
  assert.equal(showsMetric("aggregations"), false);
  assert.equal(showsMetric("map"), true);
  assert.equal(showsMetric("overtime"), true);
  assert.equal(showsMetric("overyears"), true);
  assert.equal(showsMetric("pivot"), true);
});

Deno.test("showsYearSlider: only the map (heatmap + over-years span all years)", () => {
  assert.equal(showsYearSlider("map"), true);
  assert.equal(showsYearSlider("overtime"), false);
  assert.equal(showsYearSlider("overyears"), false);
  assert.equal(showsYearSlider("pivot"), false);
  assert.equal(showsYearSlider("list"), false);
  assert.equal(showsYearSlider("aggregations"), false);
});
