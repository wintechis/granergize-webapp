/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { renderConsumption } from "../../../scripts/genVocabInterface.ts";
import type { AggregationDefinition, AggregationSnapshot, EnergyDatasetRef } from "../../types.ts";

Deno.test("generated consumption shape is fresh (matches a regeneration from the bridge+vocab)", () => {
  const committed = Deno.readTextFileSync(
    new URL("./consumptionShape.generated.ts", import.meta.url),
  );
  assert.equal(
    renderConsumption(),
    committed,
    "consumptionShape.generated.ts is stale — run `deno task gen:interface`",
  );
});

Deno.test("consumption types carry the generated vocab fields", () => {
  // Compile-time: these assignments only hold if the generated *Fields are mixed in.
  const ds: Pick<EnergyDatasetRef, "granularity" | "scenario"> = {
    granularity: "P1Y",
    scenario: "actual",
  };
  const def: Pick<AggregationDefinition, "name" | "aggregationType" | "benchmark"> = {
    name: "x",
    aggregationType: "sum",
    benchmark: true,
  };
  const snap: Pick<AggregationSnapshot, "computedAt" | "buildingCount"> = {
    computedAt: "2024-01-01T00:00:00Z",
    buildingCount: 3,
  };
  assert.equal(ds.scenario, "actual");
  assert.equal(def.aggregationType, "sum");
  assert.equal(snap.buildingCount, 3);
});
