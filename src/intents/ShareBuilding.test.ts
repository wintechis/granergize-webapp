/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
//
// Tier-1 proof that the ShareBuilding core is callable HEADLESS: it is driven
// directly with a fake offline-fixture Session — no React, no renderHook, no
// component tree — and asserted to perform the expected per-recipient Pod writes
// and return the tally.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { shareBuildingCore } from "./ShareBuilding.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const SHARED_OUT = "https://a.example/granergize/shared-out/";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const BOB_INBOX = "https://bob.example/granergize/inbox/";
const CAROL_INBOX = "https://carol.example/granergize/inbox/";

const BUILDING_TTL = `
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
<${BUILDING}#b-1> a <https://w3id.org/rec#Building> .
`;

interface Call {
  url: string;
  method: string;
  body?: string;
}

/**
 * Stateful fake two-Pod world: the owner's building + shared-out/ on a.example,
 * each recipient's profile (so inbox discovery resolves their storage root) and
 * inbox elsewhere. Records every call so the per-recipient writes can be counted.
 */
function sharePod(): { session: PodGateway; calls: Call[]; store: Record<string, string> } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {
    [BUILDING]: BUILDING_TTL,
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
    session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session),
    calls,
    store,
  };
}

Deno.test("shareBuildingCore (headless): one recipient → one grant event, one inbox post, tally 1", async () => {
  const { session, calls } = sharePod();

  const outcome = await shareBuildingCore(session, {
    buildingUri: `${BUILDING}#b-1`,
    recipients: [BOB],
    includeEnergyData: false,
  });

  // The outcome is a per-recipient tally (a write outcome, never a value).
  assert.deepEqual(outcome, { recipientsShared: 1 });

  // The shared-out/ log (ground truth) got exactly one POSTed grant event.
  const logAppends = calls.filter((c) => c.method === "POST" && c.url === SHARED_OUT);
  assert.equal(logAppends.length, 1, "one grant event appended to shared-out/");

  // At least one ACL projection was written (the building file's .acl).
  assert.ok(
    calls.some((c) => c.method === "PUT" && c.url === `${BUILDING}.acl`),
    "building .acl projected",
  );

  // The recipient's inbox was notified once.
  const inboxPosts = calls.filter((c) => c.method === "POST" && c.url === BOB_INBOX);
  assert.equal(inboxPosts.length, 1, "recipient inbox notified once");
});

Deno.test("shareBuildingCore (headless): N recipients → N grant events + N inbox posts, tally N", async () => {
  const { session, calls } = sharePod();

  const outcome = await shareBuildingCore(session, {
    buildingUri: `${BUILDING}#b-1`,
    recipients: [BOB, CAROL],
    includeEnergyData: false,
  });

  assert.deepEqual(outcome, { recipientsShared: 2 });

  // One grant event per recipient on the shared-out/ log.
  const logAppends = calls.filter((c) => c.method === "POST" && c.url === SHARED_OUT);
  assert.equal(logAppends.length, 2, "one grant event per recipient");

  // One inbox notify per recipient, each to that recipient's own inbox.
  assert.equal(calls.filter((c) => c.method === "POST" && c.url === BOB_INBOX).length, 1);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url === CAROL_INBOX).length, 1);
});
