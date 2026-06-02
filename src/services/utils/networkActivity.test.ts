/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  beginActivity,
  describeRequest,
  endActivity,
  getActivitySnapshot,
  instrumentSessionFetch,
  subscribeActivity,
  trackedFetch,
} from "./networkActivity.ts";

// The store is module-global, so each test works in deltas off the live snapshot
// and cleans up what it starts.

Deno.test("beginActivity/endActivity add and remove from the snapshot", () => {
  const base = getActivitySnapshot().length;
  const id = beginActivity("GET thing");
  assert.equal(getActivitySnapshot().length, base + 1);
  assert.ok(getActivitySnapshot().some((r) => r.label === "GET thing"));
  endActivity(id);
  assert.equal(getActivitySnapshot().length, base);
  // idempotent: ending an unknown/old token does nothing.
  endActivity(id);
  assert.equal(getActivitySnapshot().length, base);
});

Deno.test("subscribeActivity notifies and unsubscribes", () => {
  let hits = 0;
  const unsub = subscribeActivity(() => hits++);
  const id = beginActivity("x");
  endActivity(id);
  assert.equal(hits, 2, "begin + end each notify");
  unsub();
  const id2 = beginActivity("y");
  endActivity(id2);
  assert.equal(hits, 2, "no notifications after unsubscribe");
});

Deno.test("describeRequest formats METHOD + host/path, stripping query & hash", () => {
  assert.equal(
    describeRequest("https://pod.example/granergize/x.ttl?t=1#f"),
    "GET pod.example/granergize/x.ttl",
  );
  assert.equal(
    describeRequest("https://pod.example/granergize/x.ttl", { method: "put" }),
    "PUT pod.example/granergize/x.ttl",
  );
  assert.equal(describeRequest("relative-thing"), "GET relative-thing");
});

Deno.test("trackedFetch brackets the call with begin→end (even on throw)", async () => {
  const realFetch = globalThis.fetch;
  const base = getActivitySnapshot().length;

  // success path
  globalThis.fetch = (() => Promise.resolve(new Response("ok"))) as typeof fetch;
  await trackedFetch("https://x.example/a", undefined, "label-a");
  assert.equal(getActivitySnapshot().length, base, "ended after success");

  // failure path still ends
  globalThis.fetch = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  await assert.rejects(() => trackedFetch("https://x.example/b"));
  assert.equal(getActivitySnapshot().length, base, "ended after rejection");

  globalThis.fetch = realFetch;
});

Deno.test("instrumentSessionFetch tracks each pod request and is idempotent", async () => {
  let resolve!: (r: Response) => void;
  const session = {
    fetch: (() => new Promise<Response>((r) => (resolve = r))) as typeof fetch,
  };

  instrumentSessionFetch(session);
  const wrapped = session.fetch;
  instrumentSessionFetch(session); // second call must not re-wrap
  assert.equal(session.fetch, wrapped, "not double-wrapped");

  const base = getActivitySnapshot().length;
  const p = session.fetch("https://pod.example/granergize/x.ttl");
  assert.equal(getActivitySnapshot().length, base + 1, "tracked while in flight");
  assert.ok(
    getActivitySnapshot().some((r) =>
      r.label === "GET pod.example/granergize/x.ttl"
    ),
  );
  resolve(new Response("ok"));
  await p;
  assert.equal(getActivitySnapshot().length, base, "untracked once resolved");
});
