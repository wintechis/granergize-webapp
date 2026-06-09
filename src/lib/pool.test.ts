/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { mapPooled } from "./pool.ts";

Deno.test("mapPooled: preserves order and processes every item", async () => {
  const out = await mapPooled([1, 2, 3, 4, 5], 2, (n) => Promise.resolve(n * 10));
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

Deno.test("mapPooled: passes the index", async () => {
  const out = await mapPooled(["a", "b", "c"], 2, (s, i) => Promise.resolve(`${i}:${s}`));
  assert.deepEqual(out, ["0:a", "1:b", "2:c"]);
});

Deno.test("mapPooled: never exceeds the concurrency limit", async () => {
  let active = 0;
  let max = 0;
  await mapPooled(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  assert.ok(max <= 3, `max concurrency ${max} exceeded limit 3`);
  assert.ok(max >= 2, `expected real concurrency, got ${max}`);
});

Deno.test("mapPooled: empty input returns empty", async () => {
  assert.deepEqual(await mapPooled([], 4, () => Promise.resolve(1)), []);
});

Deno.test("mapPooled: limit larger than item count still works", async () => {
  const out = await mapPooled([1, 2], 10, (n) => Promise.resolve(n));
  assert.deepEqual(out, [1, 2]);
});
