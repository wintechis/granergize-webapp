/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  detailIndexFromSlug,
  mergeParams,
  slugFromDetailIndex,
  slugFromTabIndex,
  tabIndexFromSlug,
} from "./uriState.ts";

Deno.test("tabIndexFromSlug maps each home slug to its index", () => {
  assert.equal(tabIndexFromSlug("explore"), 0);
  assert.equal(tabIndexFromSlug("manage"), 1);
  assert.equal(tabIndexFromSlug("share"), 2);
  assert.equal(tabIndexFromSlug("connect"), 3);
});

Deno.test("tabIndexFromSlug defaults unknown/missing to Explore (0)", () => {
  assert.equal(tabIndexFromSlug("bogus"), 0);
  assert.equal(tabIndexFromSlug(""), 0);
  assert.equal(tabIndexFromSlug(null), 0);
  assert.equal(tabIndexFromSlug(undefined), 0);
});

Deno.test("slugFromTabIndex round-trips and clamps out-of-range", () => {
  assert.equal(slugFromTabIndex(0), "explore");
  assert.equal(slugFromTabIndex(3), "connect");
  assert.equal(slugFromTabIndex(99), "explore"); // out-of-range → first
  assert.equal(slugFromTabIndex(-1), "explore");
});

Deno.test("detail sub-tab slugs map to indices and back", () => {
  assert.equal(detailIndexFromSlug("building"), 0);
  assert.equal(detailIndexFromSlug("energy"), 1);
  assert.equal(detailIndexFromSlug("weather"), 2);
  assert.equal(detailIndexFromSlug("nope"), 0);
  assert.equal(slugFromDetailIndex(2), "weather");
  assert.equal(slugFromDetailIndex(5), "building"); // out-of-range → first
});

Deno.test("mergeParams sets, deletes on null, and leaves other keys untouched", () => {
  const prev = new URLSearchParams("tab=manage&b=42&dt=energy");

  // Set one key — the others survive (no clobber).
  const set = mergeParams(prev, { dt: "weather" });
  assert.equal(set.get("tab"), "manage");
  assert.equal(set.get("b"), "42");
  assert.equal(set.get("dt"), "weather");

  // null deletes only that key.
  const del = mergeParams(prev, { b: null, dt: null });
  assert.equal(del.get("tab"), "manage");
  assert.equal(del.has("b"), false);
  assert.equal(del.has("dt"), false);

  // The original is not mutated.
  assert.equal(prev.get("dt"), "energy");
});
