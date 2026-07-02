/// <reference lib="deno.ns" />
// The master-data → consumption-entry linkage: a building's declared systems
// order the entry form's metrics (relevant first, rest de-emphasised) WITHOUT
// touching the unified six-metric schema — nothing hidden, nothing dropped.
import { strict as assert } from "node:assert";
import {
  ANNUAL_METRICS,
  orderedAnnualMetrics,
  relevantMetricKeys,
} from "./annualMetrics.ts";
import type { TechnicalSystem } from "../types/building.ts";

const sys = (kind: TechnicalSystem["kind"]): TechnicalSystem => ({
  id: kind,
  kind,
});

Deno.test("no declared systems → the canonical order, every metric relevant (unlinked form)", () => {
  for (const systems of [undefined, []]) {
    const out = orderedAnnualMetrics(systems);
    assert.deepEqual(
      out.map((m) => m.key),
      ANNUAL_METRICS.map((m) => m.key),
      "canonical order untouched",
    );
    assert.ok(out.every((m) => m.relevant), "nothing de-emphasised");
  }
});

Deno.test("a heat generator pulls heat consumption forward; producers pull generation + share", () => {
  const out = orderedAnnualMetrics([sys("gasboiler"), sys("pv")]);
  assert.deepEqual(
    out.map((m) => m.key),
    [
      // relevant, in canonical relative order …
      "electricityConsumption",
      "heatConsumption",
      "renewableSelfGeneratedShare",
      "electricityGeneration",
      // … then the never-system-derived rest, de-emphasised.
      "waterConsumption",
      "wastewaterConsumption",
    ],
  );
  assert.deepEqual(
    out.filter((m) => !m.relevant).map((m) => m.key),
    ["waterConsumption", "wastewaterConsumption"],
  );
});

Deno.test("relevantMetricKeys: electricity is the always-relevant baseline; battery adds nothing", () => {
  assert.deepEqual(
    [...relevantMetricKeys([sys("battery")])],
    ["electricityConsumption"],
  );
  // Every heat kind counts as a heat generator.
  for (
    const k of [
      "heatpump",
      "gasboiler",
      "districtheating",
      "oilboiler",
      "electricboiler",
    ] as const
  ) {
    assert.ok(
      relevantMetricKeys([sys(k)]).has("heatConsumption"),
      `${k} makes heat consumption relevant`,
    );
  }
  assert.ok(relevantMetricKeys([sys("chp")]).has("electricityGeneration"));
});

Deno.test("the unified schema is untouched: same six keys, whatever the systems", () => {
  const keys = (systems?: TechnicalSystem[]) =>
    orderedAnnualMetrics(systems).map((m) => m.key).sort();
  assert.deepEqual(keys([sys("heatpump"), sys("chp")]), keys(undefined));
});
