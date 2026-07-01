/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { affordanceFor, INTENT_AFFORDANCES } from "./affordances.ts";
import { applicableIntents, findIntent } from "./applicable.ts";
import { intentExposure, INTENTS } from "./catalog.ts";
import type { AggregationDefinition, Building } from "../types.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function building(over: Partial<Building> = {}): Building {
  return {
    id: "granergize/buildings/b1.ttl#it",
    uri: "https://alice.example/granergize/buildings/b1.ttl",
    type: "building",
    ...over,
  } as Building;
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

Deno.test("account-scope verbs apply regardless of devMode (the exposure gate is elsewhere)", () => {
  for (const v of ["ExportArchive", "DeleteAppData", "DrainInbox"]) {
    assert.ok(affordanceFor(v).applies({ kind: "Account" }, { devMode: false }));
    assert.ok(affordanceFor(v).applies({ kind: "Account" }, { devMode: true }));
  }
});

// ── Single-encoding invariants: dev-gating lives in the CATALOG exposure only ──

Deno.test("the affordance table encodes NO dev-gating (exposure is the one dev gate)", () => {
  // Dev-exposure was once encoded twice — catalog `exposure: "developer"` AND
  // an affordance-side devOnly guard — and the two disagreed (SeedDemoBuildings
  // was exposure-developer yet applies-always). The guard table answers only
  // OBJECT applicability now: for every verb, the answer must not depend on
  // the viewer's devMode (applicableIntents applies the exposure gate once).
  for (const [name, a] of Object.entries(INTENT_AFFORDANCES)) {
    for (const object of [undefined, { kind: "Account" } as const]) {
      assert.equal(
        a.applies(object, { devMode: false }),
        a.applies(object, { devMode: true }),
        `${name}: applicability must not re-encode the dev gate`,
      );
    }
  }
});

Deno.test("every non-navigate catalog verb declares its applicability explicitly", () => {
  // A silent default-never hides a verb from every affordance surface with no
  // record of the decision (CheckObservationLinks fell through this hole).
  const missing = INTENTS
    .filter((e) => e.effect !== "navigate")
    .filter((e) => !(e.name in INTENT_AFFORDANCES))
    .map((e) => e.name);
  assert.deepEqual(missing, [], "every verb takes an explicit applies stance");
});

Deno.test("a developer verb is never OFFERED to a non-dev viewer (the exposure gate)", () => {
  const offered = applicableIntents({ kind: "Account" }, { devMode: false })
    .map((e) => e.name);
  for (const e of INTENTS.filter((x) => intentExposure(x) === "developer")) {
    assert.ok(
      !offered.includes(e.name),
      `${e.name} is developer-exposed and must not be offered outside dev mode`,
    );
  }
});
