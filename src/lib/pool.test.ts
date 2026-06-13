/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { createLimiter, mapPooled } from "./pool.ts";

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

Deno.test("createLimiter: caps concurrency across a recursive fan-out", async () => {
  // Unlike mapPooled (which bounds one map), a single limiter bounds EVERY leaf
  // call made through it, even from inside an unbounded recursive descent — the
  // case mapPooled-per-level can't hold (its caps multiply with depth). Gate only
  // the leaf I/O, never the descent itself (a slot held across recursion would
  // deadlock a tree deeper than the limit — see deleteContainerRecursive).
  const limit = createLimiter(3);
  let active = 0;
  let max = 0;
  const leaf = () =>
    limit(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  const descend = async (depth: number): Promise<void> => {
    // 3 leaf calls + recurse — the descent is NOT gated, only the leaves are.
    await Promise.all([
      ...Array.from({ length: 3 }, leaf),
      ...(depth > 0 ? [descend(depth - 1)] : []),
    ]);
  };
  // A wide+deep tree: a per-level cap would let leaves multiply into the dozens.
  await Promise.all(Array.from({ length: 4 }, () => descend(3)));
  assert.ok(max <= 3, `max concurrency ${max} exceeded the global limit 3`);
  assert.ok(max >= 2, `expected real concurrency, got ${max}`);
});

Deno.test("createLimiter: preserves each call's result and order", async () => {
  const limit = createLimiter(2);
  const out = await Promise.all(
    [1, 2, 3, 4].map((n) => limit(() => Promise.resolve(n * 10))),
  );
  assert.deepEqual(out, [10, 20, 30, 40]);
});

Deno.test("createLimiter: a throwing task frees its slot (no deadlock)", async () => {
  const limit = createLimiter(1);
  await assert.rejects(() => limit(() => Promise.reject(new Error("boom"))));
  // If the slot leaked, this second call would hang forever.
  assert.equal(await limit(() => Promise.resolve("ok")), "ok");
});
