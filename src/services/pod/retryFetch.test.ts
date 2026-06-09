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

/** A fetch that rejects with a DOMException AbortError on the first N calls. */
function abortingFetch(throwsBeforeSuccess: number) {
  let calls = 0;
  const fn = (() => {
    calls++;
    if (calls <= throwsBeforeSuccess) {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    return Promise.resolve(new Response(null, { status: 201 }));
  }) as typeof fetch;
  return { fn, get calls() {
    return calls;
  } };
}

Deno.test("withRetry: retries a browser-level abort the caller didn't request", async () => {
  const f = abortingFetch(1);
  const res = await withRetry(f.fn, FAST)("https://x/", { method: "PUT" });
  assert.equal(res.status, 201); // the idempotent write replays and lands
  assert.equal(f.calls, 2);
});

Deno.test("withRetry: does NOT retry a caller-cancelled request (its own signal aborted)", async () => {
  const f = abortingFetch(1);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => withRetry(f.fn, FAST)("https://x/", { method: "PUT", signal: ctrl.signal }),
    DOMException,
  );
  assert.equal(f.calls, 1); // user cancel → not retried
});

Deno.test("withRetry: passes non-retryable responses straight through", async () => {
  const f = scriptedFetch([404]);
  const res = await withRetry(f.fn, FAST)("https://x/");
  assert.equal(res.status, 404);
  assert.equal(f.calls, 1);
});

/** A fetch that, for its first `stalls` calls, never sends a response on its own
 * and only rejects when its signal aborts (exactly how the platform `fetch`
 * behaves on a stalled connection); later calls succeed. */
function stallingFetch(stalls: number) {
  let calls = 0;
  const fn = ((_input: unknown, init?: RequestInit) => {
    calls++;
    const n = calls;
    return new Promise<Response>((resolve, reject) => {
      if (n > stalls) {
        resolve(new Response(null, { status: 201 }));
        return;
      }
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
      );
    });
  }) as typeof fetch;
  return { fn, get calls() {
    return calls;
  } };
}

Deno.test("withRetry: times out a stalled attempt and a fresh retry lands", async () => {
  const f = stallingFetch(1); // first attempt hangs, second responds
  const res = await withRetry(f.fn, { baseDelayMs: 0, maxRetries: 3, timeoutMs: 20 })(
    "https://x/",
    { method: "DELETE" },
  );
  assert.equal(res.status, 201);
  assert.equal(f.calls, 2);
});

Deno.test("withRetry: gives up (throws) when every attempt stalls", async () => {
  const f = stallingFetch(99); // always hangs
  await assert.rejects(
    () =>
      withRetry(f.fn, { baseDelayMs: 0, maxRetries: 2, timeoutMs: 20 })("https://x/"),
    DOMException,
  );
  assert.equal(f.calls, 3); // initial + 2 retries, none ever responded
});

Deno.test("withRetry: a caller cancel beats the timeout and is not retried", async () => {
  const f = stallingFetch(99);
  const ctrl = new AbortController();
  const p = withRetry(f.fn, { baseDelayMs: 0, maxRetries: 3, timeoutMs: 10_000 })(
    "https://x/",
    { method: "DELETE", signal: ctrl.signal },
  );
  ctrl.abort(); // user cancels before the (long) timeout fires
  await assert.rejects(() => p, DOMException);
  assert.equal(f.calls, 1); // not retried
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
