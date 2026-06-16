/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { affordanceFor, INTENT_AFFORDANCES } from "./affordances.ts";
import { findIntent } from "./applicable.ts";

// ── Keys reference real catalog intents ──────────────────────────────────────

Deno.test("every affordance key names a real catalog intent", () => {
  for (const name of Object.keys(INTENT_AFFORDANCES)) {
    assert.ok(findIntent(name), `affordance key ${name} has no catalog entry`);
  }
});

// ── affordanceFor default ────────────────────────────────────────────────────

Deno.test("affordanceFor defaults to no params + never-applies for an unknown name", () => {
  const a = affordanceFor("NotAnIntent");
  assert.deepEqual(a.params, []);
  assert.equal(a.applies(undefined, { devMode: true }), false);
});

// ── params reflect the hook's vars shape ─────────────────────────────────────

Deno.test("params record the hook's parameter field names", () => {
  assert.deepEqual(affordanceFor("ShareBuilding").params, [
    "buildingUri",
    "recipients",
    "includeEnergyData",
    "years",
  ]);
  // A param-less collection/dev verb.
  assert.deepEqual(affordanceFor("ExportArchive").params, []);
});
