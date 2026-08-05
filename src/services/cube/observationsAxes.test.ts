/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DEFAULT_VIEW,
  type ObsView,
  resolveSeries,
  resolveView,
  seriesToParams,
  showsMetric,
  showsSeriesDrill,
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

// ── The time drill (`?series=`) ────────────────────────────────────────────────

Deno.test("resolveSeries: absent / empty → null (no drill)", () => {
  assert.equal(resolveSeries(p("")), null);
  assert.equal(resolveSeries(p("series=")), null);
  assert.equal(resolveSeries(p("view=pivot&m=heat")), null);
});

Deno.test("resolveSeries: the building ref passes through in BOTH id forms", () => {
  // Own building: the storage-relative ref the detail routes carry as `?ref=`.
  assert.equal(
    resolveSeries(p(`series=${encodeURIComponent("buildings/abc.ttl#it")}`)),
    "buildings/abc.ttl#it",
  );
  // Shared building: the absolute IRI they carry as `?uri=`. The axis validates
  // nothing — an unresolvable ref is the finder's (data) question, not the URI's.
  const iri = "https://bob.example/granergize/buildings/x.ttl#it";
  assert.equal(resolveSeries(p(`series=${encodeURIComponent(iri)}`)), iri);
  assert.equal(resolveSeries(p("series=not-a-building")), "not-a-building");
});

Deno.test("seriesToParams: sets / clears, preserving the view + coordinate", () => {
  const prev = p("view=pivot&m=heat&y=2023&rows=kreis&in=09&offset=20");
  const out = seriesToParams("buildings/abc.ttl#it", prev);
  assert.equal(out.get("series"), "buildings/abc.ttl#it");
  assert.equal(out.get("view"), "pivot");
  assert.equal(out.get("m"), "heat");
  assert.equal(out.get("y"), "2023");
  assert.equal(out.get("rows"), "kreis");
  assert.equal(out.get("in"), "09");
  assert.equal(out.get("offset"), "20");
  // Closing omits the param entirely (clean URI), leaving the rest untouched.
  const closed = seriesToParams(null, out);
  assert.equal(closed.get("series"), null);
  assert.equal(closed.get("view"), "pivot");
  assert.equal(closed.get("rows"), "kreis");
  // An empty ref closes it too, rather than writing `?series=`.
  assert.equal(seriesToParams("", out).get("series"), null);
});

Deno.test("the drill rides along a view switch (it is URL state, not view state)", () => {
  // Switching projections never rewrites another axis: the drill survives, inert on
  // the projections that show no building row, and the panel returns on the way back.
  const out = viewToParams("map", p("view=pivot&series=buildings/abc.ttl%23it"));
  assert.equal(out.get("series"), "buildings/abc.ttl#it");
});

Deno.test("showsSeriesDrill: only the two grid projections", () => {
  assert.equal(showsSeriesDrill("overtime"), true);
  assert.equal(showsSeriesDrill("pivot"), true);
  assert.equal(showsSeriesDrill("map"), false);
  assert.equal(showsSeriesDrill("list"), false);
  assert.equal(showsSeriesDrill("overyears"), false);
  assert.equal(showsSeriesDrill("aggregations"), false);
});

Deno.test("showsYearSlider: only the map (heatmap + over-years span all years)", () => {
  assert.equal(showsYearSlider("map"), true);
  assert.equal(showsYearSlider("overtime"), false);
  assert.equal(showsYearSlider("overyears"), false);
  assert.equal(showsYearSlider("pivot"), false);
  assert.equal(showsYearSlider("list"), false);
  assert.equal(showsYearSlider("aggregations"), false);
});
