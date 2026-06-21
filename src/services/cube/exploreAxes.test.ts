/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DEFAULT_AXES,
  pickRenderer,
  resolveAxes,
  toParams,
} from "./exploreAxes.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveAxes: empty / unknown → the default (map)", () => {
  assert.deepEqual(resolveAxes(p("")), DEFAULT_AXES);
  assert.deepEqual(resolveAxes(p("space=zzz")), DEFAULT_AXES);
});

Deno.test("resolveAxes: space=rows passes through", () => {
  assert.deepEqual(resolveAxes(p("space=rows")), { space: "rows" });
});

Deno.test("toParams: omits the default, sets rows, preserves unrelated params", () => {
  const prev = p("c=51,10&z=6&offset=20");
  const out = toParams({ space: "rows" }, prev);
  assert.equal(out.get("space"), "rows");
  assert.equal(out.get("c"), "51,10", "viewport survives");
  assert.equal(out.get("offset"), "20", "pager survives");
  // the default writes a clean URL (no ?space)
  assert.equal(toParams({ space: "map" }, p("offset=20")).get("space"), null);
  assert.equal(toParams({ space: "map" }, p("offset=20")).get("offset"), "20");
});

Deno.test("pickRenderer: map → map, rows → list", () => {
  assert.equal(pickRenderer({ space: "map" }), "map");
  assert.equal(pickRenderer({ space: "rows" }), "list");
});
