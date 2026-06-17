/// <reference lib="deno.ns" />
//
// Drift guard for the reified param schema (params.ts). Pins INTENT_PARAMS to the
// catalog (no orphan keys) and asserts it covers the invocable intents. The
// param↔core binding itself rests SOLELY on the compile-time
// `_paramKeysMatch`/`ParamKeysMatch` witnesses in params.ts (checked by tsc):
// each schema's field set must equal its core's modelled param keys (runtime-only
// handles like `signal` excluded). There is no longer an affordance-bag to compare
// against — `IntentAffordance` carries only `applies`, and dialog-routing keys off
// these modelled params (`hasModelledParams` in commandPalette.ts).
import { strict as assert } from "node:assert";
import { INTENT_PARAMS } from "./params.ts";
import { INTENT_AFFORDANCES } from "./affordances.ts";
import { findIntent } from "./applicable.ts";

Deno.test("every INTENT_PARAMS key names a real catalog intent", () => {
  for (const name of Object.keys(INTENT_PARAMS)) {
    assert.ok(findIntent(name), `INTENT_PARAMS key ${name} has no catalog entry`);
  }
});

Deno.test("INTENT_PARAMS covers every affordance-bearing intent", () => {
  // Every verb a surface can offer (it has an affordance entry) must carry a
  // modelled param schema, so dialog-routing always has a basis to read.
  for (const name of Object.keys(INTENT_AFFORDANCES)) {
    assert.ok(
      name in INTENT_PARAMS,
      `affordance intent ${name} has no INTENT_PARAMS schema`,
    );
  }
});
