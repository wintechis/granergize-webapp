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
import { _setStorageRootForTesting } from "./solidUtils.ts";

const ALICE = "https://alice.example/profile/card#me";

_setStorageRootForTesting(ALICE, "https://alice.example/");

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

Deno.test("instrumentSessionFetch: a foreign-Pod 401 does NOT trip the gate", async () => {
  resetSessionGate();
  let calls = 0;
  const session = {
    info: { webId: ALICE },
    fetch: (() => {
      calls++;
      return Promise.resolve(new Response(null, { status: 401 }));
    }) as typeof fetch,
  };
  instrumentSessionFetch(session);

  // Someone else's Pod: a 401 there is an ordinary outcome (e.g. revoked share).
  const res = await session.fetch("https://bob.example/x.ttl");
  assert.equal(res.status, 401);
  assert.equal(calls, 1, "no confirm retry for a foreign-Pod 401");
  assert.equal(isSessionExpired(), false);
});

Deno.test("instrumentSessionFetch: an own-Pod 401 that recovers on retry does NOT trip the gate", async () => {
  resetSessionGate();
  let calls = 0;
  const session = {
    info: { webId: ALICE },
    fetch: (() => {
      calls++;
      // First attempt races the token refresh (401); the retry succeeds.
      return Promise.resolve(
        calls === 1 ? new Response(null, { status: 401 }) : new Response("ok"),
      );
    }) as typeof fetch,
  };
  instrumentSessionFetch(session);

  const res = await session.fetch("https://alice.example/granergize/x.ttl");
  assert.equal(res.status, 200, "the caller sees the recovered response");
  assert.equal(calls, 2, "exactly one confirm retry");
  assert.equal(isSessionExpired(), false);
});

Deno.test("instrumentSessionFetch: a CONFIRMED own-Pod 401 trips the gate", async () => {
  resetSessionGate();
  let calls = 0;
  const session = {
    info: { webId: ALICE },
    fetch: (() => {
      calls++;
      return Promise.resolve(new Response(null, { status: 401 }));
    }) as typeof fetch,
  };
  instrumentSessionFetch(session);

  const res = await session.fetch("https://alice.example/granergize/x.ttl");
  assert.equal(res.status, 401);
  assert.equal(calls, 2, "the 401 was confirmed by a retry before tripping");
  assert.equal(isSessionExpired(), true);

  // Tripped gate → subsequent requests short-circuit without hitting the network.
  await session.fetch("https://alice.example/granergize/y.ttl");
  assert.equal(calls, 2);
  resetSessionGate();
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
