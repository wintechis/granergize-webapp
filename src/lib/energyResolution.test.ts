/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { splitEnergyDatasets } from "./energyResolution.ts";
import type { EnergyDatasetRef } from "../types.ts";

const ref = (granularity: string, year = 2024): EnergyDatasetRef => ({
  url: `https://pod.example/b/energy/${year}-${granularity}.ttl#ds`,
  year,
  granularity,
  scenario: "actual",
});

Deno.test("splitEnergyDatasets: partitions by granularity kind", () => {
  const annual = ref("P1Y");
  const monthly = ref("P1M");
  const quarterHour = ref("PT15M");
  const hourly = ref("PT1H");
  const { aggregates, series } = splitEnergyDatasets([
    annual,
    quarterHour,
    monthly,
    hourly,
  ]);
  // Dated durations → aggregates, time-only → series; input order preserved.
  assert.deepEqual(aggregates, [annual, monthly]);
  assert.deepEqual(series, [quarterHour, hourly]);
});

Deno.test("splitEnergyDatasets: absent or unparseable granularity → aggregate", () => {
  const odd = ref("nonsense");
  const { aggregates, series } = splitEnergyDatasets([odd]);
  assert.deepEqual(aggregates, [odd]);
  assert.deepEqual(series, []);
});

Deno.test("splitEnergyDatasets: no datasets → both sides empty", () => {
  assert.deepEqual(splitEnergyDatasets(undefined), {
    aggregates: [],
    series: [],
  });
  assert.deepEqual(splitEnergyDatasets([]), { aggregates: [], series: [] });
});
