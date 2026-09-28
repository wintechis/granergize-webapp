/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  type EnergyTrend,
  recentTwoYears,
  TREND_FLAT_BAND,
  trendForBuildings,
  trendForDelta,
  trendFromSeries,
} from "./energyTrend.ts";
import { type EnergyByBuildingYear } from "./energyTimeCut.ts";
import { type AnnualMetrics } from "../energy/energyDataset.ts";
import { Building } from "../../types.ts";

/** One year's annual metrics (the cube cell). `year` is unused but kept for
 * call-site readability. */
function energy(_year: number, metrics: AnnualMetrics): AnnualMetrics {
  return metrics;
}

function building(fields: Partial<Building>): Building {
  return { id: "b", uri: "urn:b", ...fields } as Building;
}

// --- trendForDelta: delta → trend category --------------------------------

Deno.test("trendForDelta: intensity fell beyond the band → improving", () => {
  assert.equal(trendForDelta(-0.2), "improving");
});

Deno.test("trendForDelta: intensity rose beyond the band → worsening", () => {
  assert.equal(trendForDelta(0.2), "worsening");
});

Deno.test("trendForDelta: change within the flat band → flat", () => {
  assert.equal(trendForDelta(0), "flat");
  assert.equal(trendForDelta(TREND_FLAT_BAND), "flat"); // boundary is inclusive
  assert.equal(trendForDelta(-TREND_FLAT_BAND), "flat");
  assert.equal(trendForDelta(0.01), "flat");
});

Deno.test("trendForDelta: just outside the band tips to a direction", () => {
  assert.equal(trendForDelta(TREND_FLAT_BAND + 0.001), "worsening");
  assert.equal(trendForDelta(-(TREND_FLAT_BAND + 0.001)), "improving");
});

Deno.test("trendForDelta: null / non-finite → unknown", () => {
  assert.equal(trendForDelta(null), "unknown");
  assert.equal(trendForDelta(Number.NaN), "unknown");
  assert.equal(trendForDelta(Number.POSITIVE_INFINITY), "unknown");
});

// --- recentTwoYears: pick the two most recent comparable years ------------

Deno.test("recentTwoYears: picks the latest two of several years", () => {
  const r = recentTwoYears(
    new Map([[2020, 10], [2022, 8], [2024, 6], [2021, 9]]),
  );
  assert.equal(r.currentYear, 2024);
  assert.equal(r.priorYear, 2022);
  assert.equal(r.current, 6);
  assert.equal(r.prior, 8);
});

Deno.test("recentTwoYears: skips years with no usable intensity", () => {
  // 2024 has no figure (null) — the most recent comparable pair is 2023 vs 2022.
  const r = recentTwoYears(
    new Map([[2022, 10], [2023, 7], [2024, null]]),
  );
  assert.equal(r.currentYear, 2023);
  assert.equal(r.priorYear, 2022);
  assert.equal(r.current, 7);
  assert.equal(r.prior, 10);
});

Deno.test("recentTwoYears: a single comparable year has no prior", () => {
  const r = recentTwoYears(new Map([[2024, 6], [2023, null]]));
  assert.equal(r.currentYear, 2024);
  assert.equal(r.priorYear, null);
  assert.equal(r.prior, null);
});

Deno.test("recentTwoYears: no comparable years → all null", () => {
  const r = recentTwoYears(new Map([[2024, null]]));
  assert.equal(r.currentYear, null);
  assert.equal(r.prior, null);
});

// --- trendFromSeries: verdict + the facts behind it -----------------------

Deno.test("trendFromSeries: two comparable years carry both years and the change", () => {
  // The tooltip states these three facts, so they are asserted together.
  const d = trendFromSeries(new Map([[2022, 100], [2024, 60]]));
  assert.equal(d.trend, "improving");
  assert.equal(d.currentYear, 2024);
  assert.equal(d.priorYear, 2022);
  assert.equal(d.delta, -0.4);
});

Deno.test("trendFromSeries: the pair is the COMPARABLE one, not the last two years", () => {
  // 2022 has no usable figure, so the prior is 2020 — this is what makes the
  // tooltip's "2020 → 2024" claim true rather than merely plausible.
  const d = trendFromSeries(new Map([[2020, 100], [2022, null], [2024, 60]]));
  assert.equal(d.priorYear, 2020);
  assert.equal(d.currentYear, 2024);
  assert.equal(d.delta, -0.4);
});

Deno.test("trendFromSeries: one usable year keeps its year but has no comparison", () => {
  const d = trendFromSeries(new Map([[2024, 6], [2023, null]]));
  assert.equal(d.trend, "unknown");
  assert.equal(d.currentYear, 2024);
  assert.equal(d.priorYear, null);
  assert.equal(d.delta, null);
});

Deno.test("trendFromSeries: an empty series is all null", () => {
  const d = trendFromSeries(new Map());
  assert.equal(d.trend, "unknown");
  assert.equal(d.currentYear, null);
  assert.equal(d.priorYear, null);
  assert.equal(d.delta, null);
});

Deno.test("trendFromSeries: generation flips the VERDICT, not the delta's sign", () => {
  // betterWhenLower=false: rising output improves, but the delta still states
  // what happened (the figure rose), so it stays positive.
  const d = trendFromSeries(new Map([[2022, 100], [2024, 130]]), false);
  assert.equal(d.trend, "improving");
  assert.equal(d.delta, 0.3);
});

Deno.test("trendFromSeries: a non-positive prior yields no comparison", () => {
  // Dividing by ~zero would give an infinite change — honest "unknown" instead.
  const d = trendFromSeries(new Map([[2022, 0], [2024, 60]]));
  assert.equal(d.trend, "unknown");
  assert.equal(d.delta, null);
  assert.equal(d.priorYear, null);
});

// --- trendForBuildings: the per-building map over the cube -----------------

Deno.test("trendForBuildings: improving / worsening / unknown across the set", () => {
  // a: intensity falls 100→60 → improving; b: rises 50→80 → worsening;
  // c: only one year → unknown.
  const a = building({ id: "a", buildingArea: 100 });
  const b = building({ id: "b", buildingArea: 100 });
  const c = building({ id: "c", buildingArea: 100 });
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["a", new Map([[2022, energy(2022, { electricityConsumption: 100 })], [2024, energy(2024, { electricityConsumption: 60 })]])],
    ["b", new Map([[2022, energy(2022, { electricityConsumption: 50 })], [2024, energy(2024, { electricityConsumption: 80 })]])],
    ["c", new Map([[2024, energy(2024, { electricityConsumption: 70 })]])],
  ]);
  const trends = trendForBuildings([a, b, c], energyByBuilding);
  assert.equal(trends.get("a")!.trend, "improving");
  assert.equal(trends.get("b")!.trend, "worsening");
  assert.equal(trends.get("c")!.trend, "unknown");
  // The verdict travels with the facts the tooltip states.
  assert.equal(trends.get("a")!.priorYear, 2022);
  assert.equal(trends.get("a")!.currentYear, 2024);
  assert.equal(trends.get("a")!.delta, -0.4);
});

Deno.test("trendForBuildings: a flat-band change reads as flat", () => {
  // 100 → 103 over the area-100 building = +3 % intensity, inside ±5 %.
  const b = building({ id: "b", buildingArea: 100 });
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["b", new Map([[2022, energy(2022, { electricityConsumption: 100 })], [2024, energy(2024, { electricityConsumption: 103 })]])],
  ]);
  assert.equal(
    trendForBuildings([b], energyByBuilding).get("b")!.trend,
    "flat" as EnergyTrend,
  );
});

Deno.test("trendForBuildings: missing area drops the year from the comparison", () => {
  // 2024 has a figure but no area → no usable intensity that year, leaving only
  // 2022 comparable → unknown (a trend needs two).
  const b = building({ id: "b" }); // no area at all
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["b", new Map([[2022, energy(2022, { electricityConsumption: 100 })], [2024, energy(2024, { electricityConsumption: 60 })]])],
  ]);
  assert.equal(trendForBuildings([b], energyByBuilding).get("b")!.trend, "unknown");
});

Deno.test("trendForBuildings: empty cube → every building unknown", () => {
  const b = building({ id: "b", buildingArea: 100 });
  assert.equal(trendForBuildings([b], new Map()).get("b")!.trend, "unknown");
});

Deno.test("trendForBuildings: a magnitude metric compares the ABSOLUTE figure", () => {
  // No area on the building at all: generation is not per-m², so the comparison
  // still works — and more output reads as improving.
  const b = building({ id: "b" });
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["b", new Map([
      [2022, energy(2022, { electricityGeneration: 100 })],
      [2024, energy(2024, { electricityGeneration: 130 })],
    ])],
  ]);
  const d = trendForBuildings([b], energyByBuilding, "electricityGeneration").get("b")!;
  assert.equal(d.trend, "improving");
  assert.equal(d.delta, 0.3);
});
