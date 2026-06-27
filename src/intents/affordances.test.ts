/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { affordanceFor, INTENT_AFFORDANCES } from "./affordances.ts";
import { findIntent } from "./applicable.ts";
import type { AggregationDefinition, BuildingType } from "../types.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function building(over: Partial<BuildingType> = {}): BuildingType {
  return {
    id: "granergize/buildings/b1.ttl#it",
    uri: "https://alice.example/granergize/buildings/b1.ttl",
    type: "building",
    ...over,
  } as BuildingType;
}

function aggregation(
  over: Partial<AggregationDefinition> = {},
): AggregationDefinition {
  return {
    id: "v1",
    name: "Portfolio",
    buildingUris: [],
    aggregationType: "average",
    metrics: ["electricity"],
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

// ── Keys reference real catalog intents ──────────────────────────────────────

Deno.test("every affordance key names a real catalog intent", () => {
  for (const name of Object.keys(INTENT_AFFORDANCES)) {
    assert.ok(findIntent(name), `affordance key ${name} has no catalog entry`);
  }
});

// ── affordanceFor default ────────────────────────────────────────────────────

Deno.test("affordanceFor defaults to never-applies for an unknown name", () => {
  const a = affordanceFor("NotAnIntent");
  assert.equal(a.applies(undefined, { devMode: true }), false);
  // The affordance fact is now just the guard — no params field.
  assert.deepEqual(Object.keys(a), ["applies"]);
});

// ── applies(): own vs shared building ────────────────────────────────────────

Deno.test("owner-only verbs apply to an own building, not a shared one", () => {
  const own = building({ isShared: false });
  const shared = building({ isShared: true });
  for (const v of ["UpdateBuilding", "ShareBuilding", "DeleteBuilding"]) {
    assert.ok(affordanceFor(v).applies(own, {}), `${v} applies to own`);
    assert.ok(!affordanceFor(v).applies(shared, {}), `${v} not to shared`);
  }
});

Deno.test("ToggleVisibility applies only to a shared building", () => {
  assert.ok(affordanceFor("ToggleVisibility").applies(building({ isShared: true }), {}));
  assert.ok(!affordanceFor("ToggleVisibility").applies(building({ isShared: false }), {}));
});

// ── applies(): presence guards ───────────────────────────────────────────────

Deno.test("DeleteObservation needs an own building with energy", () => {
  const withEnergy = building({
    isShared: false,
    energyDatasets: [{ year: 2024 } as never],
  });
  const without = building({ isShared: false, energyDatasets: [] });
  assert.ok(affordanceFor("DeleteObservation").applies(withEnergy, {}));
  assert.ok(!affordanceFor("DeleteObservation").applies(without, {}));
});

Deno.test("ShareAggregation applies only with a computed snapshot", () => {
  const withSnap = aggregation({ lastComputedAt: "2026-02-01T00:00:00Z" });
  const noSnap = aggregation({ lastComputedAt: undefined });
  assert.ok(affordanceFor("ShareAggregation").applies(withSnap, {}));
  assert.ok(!affordanceFor("ShareAggregation").applies(noSnap, {}));
});

// ── applies(): developer-mode gate ───────────────────────────────────────────

Deno.test("dev-only verbs apply only with devMode on", () => {
  for (const v of ["ExportArchive", "DeleteAppData", "DrainInbox"]) {
    assert.ok(!affordanceFor(v).applies({ kind: "Account" }, { devMode: false }));
    assert.ok(affordanceFor(v).applies({ kind: "Account" }, { devMode: true }));
  }
});
