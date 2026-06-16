/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  type EnergyTrend,
  recentTwoYears,
  TREND_FLAT_BAND,
  trendDelta,
  trendForBuildings,
  trendForDelta,
} from "./energyTrend.ts";
import { type EnergyByBuildingYear } from "./energyTimeCut.ts";
import { type AnnualMetrics } from "./energyDataset.ts";
import { BuildingType } from "../../types.ts";

/** One year's annual metrics (the cube cell). `year` is unused but kept for
 * call-site readability. */
function energy(_year: number, metrics: AnnualMetrics): AnnualMetrics {
  return metrics;
}

function building(fields: Partial<BuildingType>): BuildingType {
  return { id: "b", uri: "urn:b", ...fields } as BuildingType;
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

// --- trendDelta: relative change of the recent two ------------------------

Deno.test("trendDelta: relative change of the two most recent years", () => {
  // 2024=6 vs 2022=8 → (6-8)/8 = -0.25
  const d = trendDelta(new Map([[2020, 10], [2022, 8], [2024, 6]]));
  assert.equal(d, -0.25);
});

Deno.test("trendDelta: <2 comparable years → null", () => {
  assert.equal(trendDelta(new Map([[2024, 6]])), null);
  assert.equal(trendDelta(new Map()), null);
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
  assert.equal(trends.get("a"), "improving");
  assert.equal(trends.get("b"), "worsening");
  assert.equal(trends.get("c"), "unknown");
});

Deno.test("trendForBuildings: a flat-band change reads as flat", () => {
  // 100 → 103 over the area-100 building = +3 % intensity, inside ±5 %.
  const b = building({ id: "b", buildingArea: 100 });
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["b", new Map([[2022, energy(2022, { electricityConsumption: 100 })], [2024, energy(2024, { electricityConsumption: 103 })]])],
  ]);
  assert.equal(trendForBuildings([b], energyByBuilding).get("b"), "flat" as EnergyTrend);
});

Deno.test("trendForBuildings: missing area drops the year from the comparison", () => {
  // 2024 has a figure but no area → no usable intensity that year, leaving only
  // 2022 comparable → unknown (a trend needs two).
  const b = building({ id: "b" }); // no area at all
  const energyByBuilding: EnergyByBuildingYear = new Map([
    ["b", new Map([[2022, energy(2022, { electricityConsumption: 100 })], [2024, energy(2024, { electricityConsumption: 60 })]])],
  ]);
  assert.equal(trendForBuildings([b], energyByBuilding).get("b"), "unknown");
});

Deno.test("trendForBuildings: empty cube → every building unknown", () => {
  const b = building({ id: "b", buildingArea: 100 });
  assert.equal(trendForBuildings([b], new Map()).get("b"), "unknown");
});
