/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { withConcurrencyLimit } from "./fetchLimiter.ts";

/** A fake fetch whose calls hang until the test resolves them one by one. */
function makeGate() {
  let inFlight = 0;
  let maxInFlight = 0;
  const order: string[] = [];
  const pending: Array<(res: Response) => void> = [];
  const fetchFn = ((input: string | URL | Request) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    order.push(String(input));
    return new Promise<Response>((resolve) => {
      pending.push((res) => {
        inFlight--;
        resolve(res);
      });
    });
  }) as typeof fetch;
  const finishNext = (res = new Response(null, { status: 200 })) =>
    pending.shift()?.(res);
  return {
    fetchFn,
    finishNext,
    order,
    get maxInFlight() {
      return maxInFlight;
    },
    get dispatched() {
      return order.length;
    },
  };
}

/** Let queued microtasks (acquire/release chains) run. */
const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test("withConcurrencyLimit never dispatches more than max at once", async () => {
  const gate = makeGate();
  const limited = withConcurrencyLimit(gate.fetchFn, 2);

  const calls = Array.from({ length: 5 }, (_, i) => limited(`u${i}`));
  await tick();
  assert.equal(gate.dispatched, 2, "only max calls dispatched");

  gate.finishNext();
  await tick();
  assert.equal(gate.dispatched, 3, "a freed slot dispatches the next");

  // Drain: each finish frees a slot, which dispatches the next queued call on
  // a microtask — tick between finishes so every call actually gets resolved.
  while (gate.dispatched < 5) {
    gate.finishNext();
    await tick();
  }
  gate.finishNext();
  gate.finishNext();
  await Promise.all(calls);
  assert.equal(gate.dispatched, 5, "all calls complete");
  assert.equal(gate.maxInFlight, 2, "concurrency never exceeded max");
});

Deno.test("withConcurrencyLimit dispatches queued calls in FIFO order", async () => {
  const gate = makeGate();
  const limited = withConcurrencyLimit(gate.fetchFn, 1);

  const calls = [limited("a"), limited("b"), limited("c")];
  await tick();
  gate.finishNext();
  await tick();
  gate.finishNext();
  await tick();
  gate.finishNext();
  await Promise.all(calls);
  assert.deepEqual(gate.order, ["a", "b", "c"]);
});

Deno.test("withConcurrencyLimit releases the slot when the fetch rejects", async () => {
  let calls = 0;
  const failing = (() => {
    calls++;
    return Promise.reject(new TypeError("Failed to fetch"));
  }) as unknown as typeof fetch;
  const limited = withConcurrencyLimit(failing, 1);

  await assert.rejects(() => limited("a"), TypeError);
  // The slot must be free again — a stuck slot would hang this second call.
  await assert.rejects(() => limited("b"), TypeError);
  assert.equal(calls, 2);
});

Deno.test("withConcurrencyLimit passes input and init through unchanged", async () => {
  let seen: { input?: string; init?: RequestInit } = {};
  const recording = ((input: string | URL | Request, init?: RequestInit) => {
    seen = { input: String(input), init };
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  const limited = withConcurrencyLimit(recording, 3);

  const init = { method: "PUT" };
  const res = await limited("https://pod.example/x", init);
  assert.equal(res.status, 204);
  assert.equal(seen.input, "https://pod.example/x");
  assert.equal(seen.init, init);
});
