/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  detailIndexFromSlug,
  mergeParams,
  slugFromDetailIndex,
} from "./uriState.ts";

// The active finder is the route now (`/buildings`, `/sharing`, …) — there is no
// `?tab=` and no home-tab slug mapping. What remains is the Buildings-map
// sub-state (`?b=`/`?dt=`), exercised below.

Deno.test("detail sub-tab slugs map to indices and back", () => {
  assert.equal(detailIndexFromSlug("building"), 0);
  assert.equal(detailIndexFromSlug("energy"), 1);
  assert.equal(detailIndexFromSlug("weather"), 2);
  assert.equal(detailIndexFromSlug("nope"), 0);
  assert.equal(slugFromDetailIndex(2), "weather");
  assert.equal(slugFromDetailIndex(5), "building"); // out-of-range → first
});

Deno.test("mergeParams sets, deletes on null, and leaves other keys untouched", () => {
  const prev = new URLSearchParams("b=42&dt=energy");

  // Set one key — the others survive (no clobber).
  const set = mergeParams(prev, { dt: "weather" });
  assert.equal(set.get("b"), "42");
  assert.equal(set.get("dt"), "weather");

  // null deletes only that key.
  const del = mergeParams(prev, { b: null });
  assert.equal(del.get("dt"), "energy");
  assert.equal(del.has("b"), false);

  // The original is not mutated.
  assert.equal(prev.get("dt"), "energy");
});
