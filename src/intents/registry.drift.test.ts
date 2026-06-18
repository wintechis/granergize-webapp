/// <reference lib="deno.ns" />
//
// Structural drift guard: catalog ⇄ core. `catalog.drift.test` proves the catalog
// matches `mutations.ts`; nothing yet proved a catalog entry is actually
// *invocable*. This asserts every `write` catalog entry has a key in WRITE_CORES,
// every `read` a key in READ_CORES, and there are no orphan core keys (a core for
// a name the catalog doesn't carry).
//
// `NOT_YET_EXTRACTED` is the explicit Step-5 allowlist of catalog names whose
// cores aren't extracted yet. Step 5 is COMPLETE: the allowlist is now EMPTY, so
// this guard proves the WHOLE catalog is callable headless — every `write` entry
// has a WRITE_CORES key, every `read` a READ_CORES key, with no allowlisted gaps.
// The allowlist machinery is kept (asserted empty) so a future `navigate` verb or
// a temporarily-unextracted addition has a named, guarded home rather than a hole.
import { strict as assert } from "node:assert";
import { INTENTS } from "./catalog.ts";
import { READ_CORES, WRITE_CORES } from "./registry.ts";
import { NAVIGATE_CORES } from "./navigate.ts";

/**
 * Catalog names that do NOT yet have an extracted core. **Empty** — Step 5
 * extracted the entire catalog, so every write/read entry below must resolve to a
 * core (no allowlisted gaps). Any entry added here must be a real catalog name
 * (asserted below).
 */
const NOT_YET_EXTRACTED = new Set<string>([]);

const WRITE_KEYS = new Set(Object.keys(WRITE_CORES));
const READ_KEYS = new Set(Object.keys(READ_CORES));
const CATALOG_NAMES = new Set(INTENTS.map((i) => i.name));

Deno.test("Step 5 complete: the NOT_YET_EXTRACTED allowlist is empty", () => {
  // The structural payoff — with no allowlisted gaps, the per-effect guards below
  // prove every catalog entry resolves to a core, i.e. the whole catalog is
  // callable headless via invoke()/query().
  assert.equal(NOT_YET_EXTRACTED.size, 0, "Step 5 should leave no unextracted intents");
});

Deno.test("every allowlisted name is a real catalog intent", () => {
  for (const name of NOT_YET_EXTRACTED) {
    assert.ok(CATALOG_NAMES.has(name), `allowlist name ${name} has no catalog entry`);
  }
});

Deno.test("every write catalog entry is invocable (has a WRITE_CORES key) or allowlisted", () => {
  for (const intent of INTENTS) {
    if (intent.effect !== "write") continue;
    const extracted = WRITE_KEYS.has(intent.name);
    const allowed = NOT_YET_EXTRACTED.has(intent.name);
    assert.ok(
      extracted || allowed,
      `write intent ${intent.name} has no WRITE_CORES key and isn't allowlisted`,
    );
    assert.ok(
      !(extracted && allowed),
      `write intent ${intent.name} is both extracted and allowlisted — drop it from NOT_YET_EXTRACTED`,
    );
  }
});

Deno.test("every read catalog entry is queryable (has a READ_CORES key) or allowlisted", () => {
  for (const intent of INTENTS) {
    if (intent.effect !== "read") continue;
    const extracted = READ_KEYS.has(intent.name);
    const allowed = NOT_YET_EXTRACTED.has(intent.name);
    assert.ok(
      extracted || allowed,
      `read intent ${intent.name} has no READ_CORES key and isn't allowlisted`,
    );
    assert.ok(
      !(extracted && allowed),
      `read intent ${intent.name} is both extracted and allowlisted — drop it from NOT_YET_EXTRACTED`,
    );
  }
});

Deno.test("every navigate catalog entry has a NAVIGATE_CORES key (and vice-versa)", () => {
  const navKeys = new Set(Object.keys(NAVIGATE_CORES));
  for (const intent of INTENTS) {
    if (intent.effect !== "navigate") continue;
    assert.ok(navKeys.has(intent.name), `navigate intent ${intent.name} has no NAVIGATE_CORES key`);
  }
  for (const key of navKeys) {
    assert.ok(CATALOG_NAMES.has(key), `NAVIGATE_CORES key ${key} has no catalog entry`);
  }
});

Deno.test("no orphan core keys (every WRITE/READ core key names a catalog entry)", () => {
  for (const key of WRITE_KEYS) {
    assert.ok(CATALOG_NAMES.has(key), `WRITE_CORES key ${key} has no catalog entry`);
  }
  for (const key of READ_KEYS) {
    assert.ok(CATALOG_NAMES.has(key), `READ_CORES key ${key} has no catalog entry`);
  }
});
