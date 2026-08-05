/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  clampMetric,
  DEFAULT_METRIC,
  ENERGY_TOTAL,
  isSelectableMetric,
  magnitudeCategoriserFor,
  metricFraming,
  metricLabelKey,
  metricRawAtYear,
  metricUnit,
  metricValueAtYear,
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

// --- the derived rollup rung (electricity + heat) --------------------------

Deno.test("ENERGY_TOTAL is a selectable, tier-framed, labelled measure", () => {
  const byKey = new Map(SELECTABLE_METRICS.map((m) => [m.key, m.framing]));
  assert.equal(byKey.get(ENERGY_TOTAL), "tier");
  assert.equal(metricFraming(ENERGY_TOTAL), "tier");
  assert.equal(metricLabelKey(ENERGY_TOTAL), "metricEnergyTotal");
  // Summing only the kWh carriers, so the absolute figure is kWh.
  assert.equal(metricUnit(ENERGY_TOTAL), "kWh");
  assert.equal(metricUnit("waterConsumption"), "m³");
});

Deno.test("clampMetric: the pseudo-metric survives the ?m= round trip", () => {
  assert.equal(isSelectableMetric(ENERGY_TOTAL), true);
  assert.equal(clampMetric(ENERGY_TOTAL), ENERGY_TOTAL);
  assert.equal(clampMetric("energyTotal"), "energyTotal");
});

Deno.test("metricValueAtYear: the total is (electricity + heat) / m², normalised ONCE", () => {
  const b = building({ hallArea: 100 });
  // 1000 + 500 = 1500 kWh over 100 m² → 15 kWh/m²·a (NOT 10 + 5 summed as intensities
  // — same number here by linearity, but the sum is the one that survives a gap).
  assert.equal(
    metricValueAtYear(b, { electricityConsumption: 1000, heatConsumption: 500 }, ENERGY_TOTAL),
    15,
  );
  assert.equal(
    metricRawAtYear({ electricityConsumption: 1000, heatConsumption: 500 }, ENERGY_TOTAL),
    1500,
  );
});

Deno.test("metricValueAtYear: the total is the sum of the PRESENT carriers", () => {
  const b = building({ hallArea: 100 });
  // Only electricity → that carrier alone (the cube is sparse; requiring both would
  // empty the view).
  assert.equal(metricValueAtYear(b, { electricityConsumption: 1000 }, ENERGY_TOTAL), 10);
  assert.equal(metricValueAtYear(b, { heatConsumption: 500 }, ENERGY_TOTAL), 5);
  // Water/wastewater (m³) and generation are NOT summed into it.
  assert.equal(
    metricValueAtYear(
      b,
      { electricityConsumption: 1000, waterConsumption: 40, electricityGeneration: 900 },
      ENERGY_TOTAL,
    ),
    10,
  );
});

Deno.test("metricValueAtYear: neither carrier present → no cell", () => {
  const b = building({ hallArea: 100 });
  assert.equal(metricValueAtYear(b, { waterConsumption: 40 }, ENERGY_TOTAL), null);
  assert.equal(metricValueAtYear(b, {}, ENERGY_TOTAL), null);
  assert.equal(metricValueAtYear(b, undefined, ENERGY_TOTAL), null);
  assert.equal(metricRawAtYear({ waterConsumption: 40 }, ENERGY_TOTAL), null);
  assert.equal(metricRawAtYear(undefined, ENERGY_TOTAL), null);
  // Tier framing still needs a usable area.
  assert.equal(
    metricValueAtYear(building({}), { electricityConsumption: 1000 }, ENERGY_TOTAL),
    null,
  );
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
