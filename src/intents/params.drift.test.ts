/// <reference lib="deno.ns" />
//
// Drift guard for the reified param schema (params.ts). Pins INTENT_PARAMS to the
// catalog (no orphan keys) and to the already-drift-guarded affordance bag
// (affordances.params, itself drift-guarded against the hook vars) — so the
// reified schema can't silently diverge from the hook's `vars` shape.
import { strict as assert } from "node:assert";
import { INTENT_PARAMS } from "./params.ts";
import { affordanceFor } from "./affordances.ts";
import { findIntent } from "./applicable.ts";

/** Param field names that are runtime-only handles, not modelled RDF params. */
const RUNTIME_ONLY = new Set(["signal", "onProgress", "onUploaded"]);

Deno.test("every INTENT_PARAMS key names a real catalog intent", () => {
  for (const name of Object.keys(INTENT_PARAMS)) {
    assert.ok(findIntent(name), `INTENT_PARAMS key ${name} has no catalog entry`);
  }
});

Deno.test("each schema's field set equals affordanceFor(name).params minus runtime-only fields", () => {
  for (const [name, schema] of Object.entries(INTENT_PARAMS)) {
    const schemaKeys = Object.keys(schema).sort();
    const affordanceKeys = affordanceFor(name).params
      .filter((p) => !RUNTIME_ONLY.has(p))
      .slice()
      .sort();
    assert.deepEqual(
      schemaKeys,
      affordanceKeys,
      `${name}: reified schema fields must equal the affordance params (minus runtime-only)`,
    );
  }
});
