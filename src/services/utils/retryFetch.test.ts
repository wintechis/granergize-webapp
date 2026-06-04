/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { withRetry } from "./retryFetch.ts";

/** A fake fetch that yields the given outcomes in order (status number, or a
 * thrown error via `"throw"`). Records how many times it was called. */
function scriptedFetch(outcomes: Array<number | "throw">) {
  let calls = 0;
  const fn = (() => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls++;
    if (outcome === "throw") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve(new Response(null, { status: outcome }));
  }) as typeof fetch;
  return { fn, get calls() {
    return calls;
  } };
}

const FAST = { baseDelayMs: 0, maxRetries: 3 };

Deno.test("withRetry: retries a 429 then returns the success", async () => {
  const f = scriptedFetch([429, 200]);
  const res = await withRetry(f.fn, FAST)("https://x/");
  assert.equal(res.status, 200);
  assert.equal(f.calls, 2);
});

Deno.test("withRetry: retries a thrown network error (CORS-blocked 429)", async () => {
  const f = scriptedFetch(["throw", "throw", 201]);
  const res = await withRetry(f.fn, FAST)("https://x/", { method: "PUT" });
  assert.equal(res.status, 201);
  assert.equal(f.calls, 3);
});

Deno.test("withRetry: gives up after maxRetries and returns the last 429", async () => {
  const f = scriptedFetch([429]);
  const res = await withRetry(f.fn, { baseDelayMs: 0, maxRetries: 2 })("https://x/");
  assert.equal(res.status, 429);
  assert.equal(f.calls, 3); // initial + 2 retries
});

Deno.test("withRetry: rethrows the network error after exhausting retries", async () => {
  const f = scriptedFetch(["throw"]);
  await assert.rejects(
    () => withRetry(f.fn, { baseDelayMs: 0, maxRetries: 1 })("https://x/"),
    TypeError,
  );
  assert.equal(f.calls, 2); // initial + 1 retry
});

Deno.test("withRetry: passes non-retryable responses straight through", async () => {
  const f = scriptedFetch([404]);
  const res = await withRetry(f.fn, FAST)("https://x/");
  assert.equal(res.status, 404);
  assert.equal(f.calls, 1);
});

Deno.test("withRetry: honors Retry-After (seconds) without waiting long here", async () => {
  // baseDelayMs 0 but Retry-After present → uses Retry-After; keep it tiny so the
  // test stays fast (0s is valid).
  let calls = 0;
  const fn = (() => {
    calls++;
    return Promise.resolve(
      calls === 1
        ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
        : new Response(null, { status: 200 }),
    );
  }) as typeof fetch;
  const res = await withRetry(fn, FAST)("https://x/");
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});
