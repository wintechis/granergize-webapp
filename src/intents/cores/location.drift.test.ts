/// <reference lib="deno.ns" />
//
// Structural drift guard: core FILE LOCATION ⇄ catalog entity. The cores are
// grouped into per-entity subfolders (`cores/<entity>/<Name>.ts`) so the source
// tree and the typedoc nav mirror the reified catalog. This locks that invariant:
// every write/read catalog entry's core file lives under `cores/<its entity>/`.
// A future core dropped into the flat root, or filed under the wrong entity,
// fails here. (Navigate intents have no core file — they live in NAVIGATE_CORES
// in navigate.ts — so they are skipped.)
import { strict as assert } from "node:assert";
import { INTENTS } from "../catalog.ts";

const exists = (relFromCores: string): boolean => {
  try {
    Deno.statSync(new URL(`./${relFromCores}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

Deno.test("every write/read core file lives under cores/<its catalog entity>/", () => {
  for (const intent of INTENTS) {
    if (intent.effect === "navigate") continue; // no core file
    assert.ok(intent.entity, `intent ${intent.name} (effect ${intent.effect}) has no entity`);
    const rel = `${intent.entity}/${intent.name}.ts`;
    assert.ok(
      exists(rel),
      `core for ${intent.name} should be at cores/${rel} (folder must equal catalog entity)`,
    );
  }
});
