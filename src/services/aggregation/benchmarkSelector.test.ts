/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { AggregatedViewSnapshot } from "../../types.ts";
import { pickBenchmark } from "./benchmarkSelector.ts";

function snap(
  over: Partial<AggregatedViewSnapshot> & { values: Record<string, number> },
): AggregatedViewSnapshot {
  return {
    id: "v",
    name: "Bench",
    aggregationType: "average",
    metrics: Object.keys(over.values),
    computedAt: "2026-01-01T00:00:00Z",
    buildingCount: 3,
    isBenchmark: true,
    ...over,
  };
}

Deno.test("pickBenchmark resolves the benchmark for a metric (canonical key, no translation)", () => {
  const b = pickBenchmark(
    [snap({ values: { electricityConsumption: 1410 }, computedBy: "https://bsp/#me" })],
    "electricityConsumption",
  );
  assert.equal(b?.value, 1410);
  assert.equal(b?.computedBy, "https://bsp/#me");
});

Deno.test("pickBenchmark returns null for a metric no snapshot carries", () => {
  const snaps = [snap({ values: { electricityConsumption: 1410 } })];
  assert.equal(pickBenchmark(snaps, "gasConsumption"), null); // not a benchmark metric
  assert.equal(pickBenchmark(snaps, "heatConsumption"), null); // not present in this snapshot
});

Deno.test("pickBenchmark prefers the newest snapshot carrying the metric", () => {
  const b = pickBenchmark([
    snap({ values: { heatConsumption: 800 }, computedAt: "2025-06-01T00:00:00Z", metricPeriod: "2023" }),
    snap({ values: { heatConsumption: 900 }, computedAt: "2026-06-01T00:00:00Z", metricPeriod: "2024" }),
  ], "heatConsumption");
  assert.equal(b?.value, 900);
  assert.equal(b?.metricPeriod, "2024");
});

Deno.test("pickBenchmark ignores non-benchmark snapshots", () => {
  const b = pickBenchmark(
    [snap({ values: { waterConsumption: 50 }, isBenchmark: false })],
    "waterConsumption",
  );
  assert.equal(b, null);
});

Deno.test("pickBenchmark skips a newer snapshot that lacks the metric", () => {
  // The newest snapshot covers only electricity; the older one carries water.
  const b = pickBenchmark([
    snap({ values: { waterConsumption: 50 }, computedAt: "2025-01-01T00:00:00Z" }),
    snap({ values: { electricityConsumption: 1000 }, computedAt: "2026-01-01T00:00:00Z" }),
  ], "waterConsumption");
  assert.equal(b?.value, 50);
});
