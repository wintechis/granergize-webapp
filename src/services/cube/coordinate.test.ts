/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DEFAULT_COORDINATE,
  metricToParams,
  requestedYear,
  resolveCoordinate,
  resolveMetric,
  resolveYear,
  yearToParams,
} from "./coordinate.ts";

const p = (q: string) => new URLSearchParams(q);
const YEARS = [2019, 2021, 2023];

Deno.test("resolveMetric: absent / unknown → the default measure", () => {
  assert.equal(resolveMetric(p("")), DEFAULT_COORDINATE.metric);
  assert.equal(resolveMetric(p("m=zzz")), DEFAULT_COORDINATE.metric);
  assert.equal(resolveMetric(p("m=heatConsumption")), "heatConsumption");
});

Deno.test("resolveMetric / metricToParams: the derived total round-trips on ?m=", () => {
  // The property ladder's rollup rung is a first-class value of the measure axis, so a
  // shared link carrying it resolves to it (not to the default).
  assert.equal(resolveMetric(p("m=energyTotal")), "energyTotal");
  const out = metricToParams("energyTotal", p("view=pivot&rows=kreis"));
  assert.equal(out.get("m"), "energyTotal");
  assert.equal(out.get("rows"), "kreis", "the other axes survive");
  assert.equal(resolveMetric(out), "energyTotal");
});

Deno.test("requestedYear: the raw read, before clamping", () => {
  assert.equal(requestedYear(p("")), null);
  assert.equal(requestedYear(p("y=zzz")), null);
  assert.equal(requestedYear(p("y=2020")), 2020);
});

Deno.test("resolveYear: absent → the latest reachable year", () => {
  assert.equal(resolveYear(p(""), YEARS), 2023);
  assert.equal(resolveYear(p("y=zzz"), YEARS), 2023);
});

Deno.test("resolveYear: a reachable year passes through, an unreachable one clamps", () => {
  assert.equal(resolveYear(p("y=2021"), YEARS), 2021);
  // Nearest reachable year — a stale/shared link can't select a year nobody has.
  assert.equal(resolveYear(p("y=2020"), YEARS), 2019, "ties → the earlier year");
  assert.equal(resolveYear(p("y=1990"), YEARS), 2019);
  assert.equal(resolveYear(p("y=2099"), YEARS), 2023);
});

Deno.test("resolveYear: no reachable years (cube not loaded / empty) → null", () => {
  assert.equal(resolveYear(p("y=2021"), []), null);
  assert.equal(resolveYear(p(""), []), null);
});

Deno.test("resolveCoordinate: an empty URI over an empty cube is the default coordinate", () => {
  assert.deepEqual(resolveCoordinate(p("")), DEFAULT_COORDINATE);
});

Deno.test("resolveCoordinate: composes all four axes", () => {
  const c = resolveCoordinate(p("m=heatConsumption&y=2021&rows=gemeinde&in=09"), YEARS);
  assert.deepEqual(c, {
    metric: "heatConsumption",
    year: 2021,
    rows: "gemeinde",
    scope: "09",
  });
});

Deno.test("resolveCoordinate: the scope is resolved against the RESOLVED row level", () => {
  // A scope equal to / finer than the rows would mislabel a region row, so it degrades
  // to unscoped (`prefixValidAt`) — the coordinate must not report an incoherent pair.
  assert.equal(resolveCoordinate(p("rows=land&in=09")).scope, null);
  assert.equal(resolveCoordinate(p("rows=kreis&in=09")).scope, "09");
  // An unknown row level falls back to buildings, which accept any scope.
  const c = resolveCoordinate(p("rows=zzz&in=09"));
  assert.equal(c.rows, "building");
  assert.equal(c.scope, "09");
});

Deno.test("metricToParams: writes the measure, preserves the rest of the coordinate", () => {
  const out = metricToParams("waterConsumption", p("y=2021&rows=land&view=pivot&offset=20"));
  assert.equal(out.get("m"), "waterConsumption");
  assert.equal(out.get("y"), "2021", "the time cut survives");
  assert.equal(out.get("rows"), "land", "the row level survives");
  assert.equal(out.get("view"), "pivot", "the projection survives");
  assert.equal(out.get("offset"), "20", "the pager survives");
  // The default metric is written too — it is a standing choice, not an absence.
  assert.equal(metricToParams(DEFAULT_COORDINATE.metric, p("")).get("m"), DEFAULT_COORDINATE.metric);
});

Deno.test("yearToParams: writes the time cut, null clears it, the rest survives", () => {
  const out = yearToParams(2021, p("m=heatConsumption&c=51,10&z=6"));
  assert.equal(out.get("y"), "2021");
  assert.equal(out.get("m"), "heatConsumption", "the measure survives");
  assert.equal(out.get("c"), "51,10", "the viewport survives");
  assert.equal(yearToParams(null, p("y=2021&m=heatConsumption")).get("y"), null);
  assert.equal(yearToParams(null, p("y=2021&m=heatConsumption")).get("m"), "heatConsumption");
});

Deno.test("the coordinate round-trips through its serializers", () => {
  const written = yearToParams(2021, metricToParams("heatConsumption", p("rows=kreis&in=09")));
  assert.deepEqual(resolveCoordinate(written, YEARS), {
    metric: "heatConsumption",
    year: 2021,
    rows: "kreis",
    scope: "09",
  });
});
