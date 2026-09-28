/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  clampMetric,
  DEFAULT_METRIC,
  isSelectableMetric,
  magnitudeCategoriserFor,
  metricFraming,
  metricLabelKey,
  metricRawAtYear,
  metricValueAtYear,
  metricValueUnit,
  SELECTABLE_METRICS,
} from "./energyMetric.ts";
import { type AnnualMetrics } from "../energy/energyDataset.ts";
import { Building } from "../../types.ts";

function building(fields: Partial<Building>): Building {
  return { id: "b", uri: "urn:b", ...fields } as Building;
}

// --- selectable set + framing ---------------------------------------------

Deno.test("SELECTABLE_METRICS: the four consumption metrics are tiers, generation is magnitude", () => {
  const byKey = new Map(SELECTABLE_METRICS.map((m) => [m.key, m.framing]));
  assert.equal(byKey.get("electricityConsumption"), "tier");
  assert.equal(byKey.get("heatConsumption"), "tier");
  assert.equal(byKey.get("waterConsumption"), "tier");
  assert.equal(byKey.get("wastewaterConsumption"), "tier");
  assert.equal(byKey.get("electricityGeneration"), "magnitude");
  // The % ratio metric is NOT selectable.
  assert.equal(byKey.has("renewableSelfGeneratedShare"), false);
});

Deno.test("DEFAULT_METRIC is electricity consumption (the pre-selector lens)", () => {
  assert.equal(DEFAULT_METRIC, "electricityConsumption");
  assert.equal(metricFraming(DEFAULT_METRIC), "tier");
});

Deno.test("metricFraming: generation is magnitude, consumption is tier", () => {
  assert.equal(metricFraming("electricityGeneration"), "magnitude");
  assert.equal(metricFraming("waterConsumption"), "tier");
});

Deno.test("isSelectableMetric / clampMetric: unknown falls back to the default", () => {
  assert.equal(isSelectableMetric("electricityGeneration"), true);
  assert.equal(isSelectableMetric("renewableSelfGeneratedShare"), false);
  assert.equal(isSelectableMetric("nonsense"), false);
  assert.equal(clampMetric("heatConsumption"), "heatConsumption");
  assert.equal(clampMetric("renewableSelfGeneratedShare"), DEFAULT_METRIC);
  assert.equal(clampMetric(null), DEFAULT_METRIC);
  assert.equal(clampMetric(undefined), DEFAULT_METRIC);
});

Deno.test("metricLabelKey: maps a metric to its capitalised message id", () => {
  assert.equal(metricLabelKey("electricityConsumption"), "metricElectricityConsumption");
  assert.equal(metricLabelKey("electricityGeneration"), "metricElectricityGeneration");
});

// --- per-(building, year) value: consumption = intensity, generation = absolute

Deno.test("metricValueAtYear: a consumption metric is per-m² intensity", () => {
  const b = building({ hallArea: 100 });
  const m: AnnualMetrics = { electricityConsumption: 1000 };
  // 1000 kWh / 100 m² = 10.
  assert.equal(metricValueAtYear(b, m, "electricityConsumption"), 10);
});

Deno.test("metricValueAtYear: a consumption metric needs an area (else null)", () => {
  const noArea = building({});
  assert.equal(
    metricValueAtYear(noArea, { electricityConsumption: 1000 }, "electricityConsumption"),
    null,
  );
});

Deno.test("metricValueAtYear: generation is the ABSOLUTE figure, not per-m²", () => {
  // Generation ranks by raw output — area is irrelevant; a building with NO area
  // still yields its generation magnitude.
  const noArea = building({});
  assert.equal(
    metricValueAtYear(noArea, { electricityGeneration: 5000 }, "electricityGeneration"),
    5000,
  );
  const withArea = building({ hallArea: 100 });
  assert.equal(
    metricValueAtYear(withArea, { electricityGeneration: 5000 }, "electricityGeneration"),
    5000,
  );
});

Deno.test("metricValueAtYear: a metric absent that year (or non-positive) is null", () => {
  const b = building({ hallArea: 100 });
  assert.equal(metricValueAtYear(b, { heatConsumption: 500 }, "electricityConsumption"), null);
  assert.equal(metricValueAtYear(b, { electricityConsumption: 0 }, "electricityConsumption"), null);
  assert.equal(metricValueAtYear(b, undefined, "electricityConsumption"), null);
});

Deno.test("metricValueAtYear: reads the SELECTED metric, not a fixed one", () => {
  const b = building({ hallArea: 100 });
  const m: AnnualMetrics = { electricityConsumption: 1000, heatConsumption: 2000 };
  assert.equal(metricValueAtYear(b, m, "electricityConsumption"), 10);
  assert.equal(metricValueAtYear(b, m, "heatConsumption"), 20);
});

Deno.test("metricRawAtYear: absolute figure regardless of framing/area", () => {
  // The overlay basis: absolute kWh even for a consumption metric (no per-m²).
  assert.equal(metricRawAtYear({ electricityConsumption: 1000 }, "electricityConsumption"), 1000);
  assert.equal(metricRawAtYear({ electricityGeneration: 5000 }, "electricityGeneration"), 5000);
  assert.equal(metricRawAtYear({ heatConsumption: 1 }, "electricityConsumption"), null);
  assert.equal(metricRawAtYear(undefined, "electricityConsumption"), null);
});

Deno.test("metricValueUnit: tier framing is per-m²/a, magnitude is the raw unit", () => {
  // The unit follows the framing AND the metric's own canonical unit — water is m³,
  // not the kWh the over-time tooltip used to hardcode for every metric.
  assert.equal(metricValueUnit("electricityConsumption"), "kWh/m²/a");
  assert.equal(metricValueUnit("heatConsumption"), "kWh/m²/a");
  assert.equal(metricValueUnit("waterConsumption"), "m³/m²/a");
  assert.equal(metricValueUnit("wastewaterConsumption"), "m³/m²/a");
  // Generation ranks by absolute output, so no per-area suffix.
  assert.equal(metricValueUnit("electricityGeneration"), "kWh");
});

// --- magnitude framing: neutral terciles (low/mid/high), NO good/bad ---------

Deno.test("magnitudeCategoriserFor: terciles split low / mid / high with ≥3 peers", () => {
  const classify = magnitudeCategoriserFor([10, 20, 30, 40, 50, 60]);
  assert.equal(classify(10), "low");
  assert.equal(classify(60), "high");
  assert.equal(classify(35), "mid");
  // A missing value is neutral 'none' — never a tier.
  assert.equal(classify(null), "none");
});

Deno.test("magnitudeCategoriserFor: <3 peers split on the mean; no peers → mid", () => {
  const twoPeers = magnitudeCategoriserFor([10, 30]); // mean 20
  assert.equal(twoPeers(10), "low");
  assert.equal(twoPeers(30), "high");
  assert.equal(twoPeers(20), "mid");
  const noPeers = magnitudeCategoriserFor([]);
  assert.equal(noPeers(100), "mid");
});

Deno.test("magnitudeCategoriserFor: bands are NEUTRAL — no efficient/inefficient verdict", () => {
  const classify = magnitudeCategoriserFor([10, 20, 30, 40, 50, 60]);
  const band = classify(60);
  // The high band is "high", never the consumption-tier "inefficient".
  assert.equal(band, "high");
  assert.notEqual(band as string, "inefficient");
});
