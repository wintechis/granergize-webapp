/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  getSessionExpiredSnapshot,
  isSessionExpired,
  markSessionExpired,
  resetSessionGate,
  subscribeSessionGate,
} from "./sessionGate.ts";
import { instrumentSessionFetch } from "../../lib/networkActivity.ts";

Deno.test("sessionGate: mark / reset / subscribe (idempotent)", () => {
  resetSessionGate();
  let hits = 0;
  const unsub = subscribeSessionGate(() => hits++);
  assert.equal(isSessionExpired(), false);

  markSessionExpired();
  assert.equal(isSessionExpired(), true);
  assert.equal(getSessionExpiredSnapshot(), true);
  markSessionExpired(); // already expired → no extra notification
  assert.equal(hits, 1);

  resetSessionGate();
  assert.equal(isSessionExpired(), false);
  assert.equal(hits, 2);
  unsub();
});

Deno.test("instrumentSessionFetch: a 401 does NOT trip the gate (refresh may recover)", async () => {
  resetSessionGate();
  let calls = 0;
  const session = {
    fetch: (() => {
      calls++;
      return Promise.resolve(new Response(null, { status: 401 }));
    }) as typeof fetch,
  };
  instrumentSessionFetch(session);

  const res = await session.fetch("https://pod.example/x.ttl");
  assert.equal(res.status, 401);
  assert.equal(calls, 1);
  // Expiry is driven by the library's `sessionExpired` event, not a raw 401.
  assert.equal(isSessionExpired(), false);
});

Deno.test("instrumentSessionFetch: short-circuits while expired (no network)", async () => {
  resetSessionGate();
  markSessionExpired();
  let calls = 0;
  const session = {
    fetch: (() => {
      calls++;
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch,
  };
  instrumentSessionFetch(session);

  const res = await session.fetch("https://pod.example/x.ttl");
  assert.equal(res.status, 401);
  assert.equal(calls, 0, "inner fetch is not called while the gate is tripped");
  resetSessionGate();
});
