/// <reference lib="deno.ns" />
//
// Tier-1 proof that the ShareAggregation core is callable HEADLESS: driven
// directly with a fake offline-fixture Session — no React — and asserted to
// perform the expected per-recipient Pod writes (one grant event + one snapshot
// ACL + one inbox post per recipient) and return the batch tally.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { shareAggregationCore } from "./ShareAggregation.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const SNAPSHOT = "https://a.example/granergize/aggregations/snapshots/agg-1.ttl";
const SHARED_OUT = "https://a.example/granergize/shared-out/";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const BOB_INBOX = "https://bob.example/granergize/inbox/";
const CAROL_INBOX = "https://carol.example/granergize/inbox/";

interface Call {
  url: string;
  method: string;
  body?: string;
}

/**
 * Stateful fake two-Pod world: the owner's snapshot + shared-out/ on a.example,
 * each recipient's profile (so inbox discovery resolves their storage root) and
 * inbox elsewhere. Records every call so the per-recipient writes can be counted.
 */
function sharePod(): { session: Session; calls: Call[] } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {
    ["https://bob.example/profile/card"]:
      `@prefix pim: <http://www.w3.org/ns/pim/space#> .\n<${BOB}> pim:storage <https://bob.example/> .`,
    ["https://carol.example/profile/card"]:
      `@prefix pim: <http://www.w3.org/ns/pim/space#> .\n<${CAROL}> pim:storage <https://carol.example/> .`,
  };
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[url] = String(init.body);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "HEAD") {
      return Promise.resolve(
        new Response("", { status: url.endsWith("/") || url in store ? 200 : 404 }),
      );
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: { info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session,
    calls,
  };
}

Deno.test("shareAggregationCore (headless): two recipients → 2 grant events + 2 inbox posts, tally {done:2,total:2}", async () => {
  const { session, calls } = sharePod();

  const outcome = await shareAggregationCore(session, {
    snapshotUri: SNAPSHOT,
    recipients: [BOB, CAROL],
  });

  // The outcome is a batch tally (a write outcome, never a value).
  assert.deepEqual(outcome, { done: 2, total: 2 });

  // One grant event per recipient on the shared-out/ log (ground truth).
  const logAppends = calls.filter((c) => c.method === "POST" && c.url === SHARED_OUT);
  assert.equal(logAppends.length, 2, "one grant event per recipient appended to shared-out/");

  // The snapshot's .acl projection was written.
  assert.ok(
    calls.some((c) => c.method === "PUT" && c.url === `${SNAPSHOT}.acl`),
    "snapshot .acl projected",
  );

  // One inbox notify per recipient, each to that recipient's own inbox.
  assert.equal(calls.filter((c) => c.method === "POST" && c.url === BOB_INBOX).length, 1);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url === CAROL_INBOX).length, 1);
});
