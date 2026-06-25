/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  effectiveFacetDefault,
  rememberedFacet,
  rememberedValue,
  rememberFacet,
  rememberValue,
} from "./facetMemory.ts";

const ALL = ["mine", "shared", "open"] as const;
const BASE = ["mine", "shared"];

/** Run `fn` with `globalThis.sessionStorage` swapped for `fake` (define the property
 * and restore it after, so the swap is deterministic regardless of the Deno runtime's
 * own storage). `undefined` simulates storage being absent. */
function withStorage(fake: unknown, fn: () => void) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, "sessionStorage", desc);
    else delete (globalThis as Record<string, unknown>).sessionStorage;
  }
}

/** A minimal in-memory localStorage stand-in (just the two methods we call). */
function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

Deno.test("effectiveFacetDefault: a remembered subset wins, ordered by allValues", () => {
  // Remembered out of order → re-ordered by allValues so the buttons render stably.
  assert.deepEqual(effectiveFacetDefault(["open", "mine"], BASE, ALL), ["mine", "open"]);
});

Deno.test("effectiveFacetDefault: falls back to baseDefault when nothing or junk", () => {
  assert.deepEqual(effectiveFacetDefault(null, BASE, ALL), ["mine", "shared"]);
  // A stale remembered value (no longer a known tier) drops out → base default.
  assert.deepEqual(effectiveFacetDefault(["bogus"], BASE, ALL), ["mine", "shared"]);
});

Deno.test("remember / rememberedFacet round-trip through sessionStorage", () => {
  withStorage(fakeStorage(), () => {
    assert.equal(rememberedFacet("tiers"), null); // nothing stored yet
    rememberFacet("tiers", ["mine", "open"]);
    assert.deepEqual(rememberedFacet("tiers"), ["mine", "open"]);
    // Distinct facets don't collide (keyed by param name).
    assert.equal(rememberedFacet("tier"), null);
  });
});

Deno.test("remember / rememberedValue round-trip a single-value view axis", () => {
  withStorage(fakeStorage(), () => {
    assert.equal(rememberedValue("view"), null);
    rememberValue("view", "list");
    assert.equal(rememberedValue("view"), "list");
    // The single-value and set facets share the key namespace but distinct names.
    assert.equal(rememberedValue("space"), null);
  });
});

Deno.test("rememberedFacet returns null (no throw) when storage is unavailable", () => {
  withStorage(undefined, () => {
    assert.equal(rememberedFacet("tiers"), null);
    rememberFacet("tiers", ["mine"]); // must not throw
  });
});
