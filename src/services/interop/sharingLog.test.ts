/// <reference lib="deno.ns" />
import "../../hooks/test-dom-setup.ts"; // QueryClient pulls react-query; DOM globals first
import { type PodGateway, sessionGateway } from "../pod/podGateway.ts";
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { QueryClient } from "@tanstack/react-query";
import { _setAppQueryClient } from "../../lib/appQueryClient.ts";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";
import {
  appendSharingEvent,
  buildSharingEventTurtle,
  cachedSharingGrants,
  foldSharingLog,
  parseSharingEvents,
  sharedInUri,
  sharedOutUri,
  type SharingEvent,
} from "./sharingLog.ts";

const WEBID = "https://me.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://me.example/");
const OWNER = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const B1 = "https://alice.example/granergize/buildings/b1.ttl";
const B2 = "https://alice.example/granergize/buildings/b2.ttl";

/**
 * A stateful fake Pod: PUT stores a body; POST-to-container mints a child URL and
 * stores the body; a GET of a container synthesizes an `ldp:contains` listing of
 * its direct children; HEAD on a container is 200. Lets the append/fold event-log
 * paths run offline.
 */
function makePod(): {
  session: PodGateway;
  store: Record<string, string>;
  gets: string[];
} {
  const store: Record<string, string> = {};
  const gets: string[] = [];
  let seq = 0;
  const directChildren = (container: string): string[] => {
    const out = new Set<string>();
    for (const key of Object.keys(store)) {
      if (!key.startsWith(container) || key === container) continue;
      const rest = key.slice(container.length);
      const slash = rest.indexOf("/");
      out.add(slash === -1 ? key : `${container}${rest.slice(0, slash)}/`);
    }
    return [...out];
  };
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store[url] = String(init?.body ?? "");
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === "POST") {
      const child = `${url}evt-${seq++}`;
      store[child] = String(init?.body ?? "");
      return Promise.resolve(
        new Response(null, { status: 201, headers: { Location: child } }),
      );
    }
    if (method === "HEAD") {
      return Promise.resolve(
        new Response(null, { status: url.endsWith("/") || url in store ? 200 : 404 }),
      );
    }
    gets.push(url);
    if (url.endsWith("/")) {
      const refs = directChildren(url).map((c) => `<${c}>`).join(", ");
      const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${url}> a ldp:Container${
        refs ? ` ; ldp:contains ${refs}` : ""
      } .\n`;
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    const body = store[url];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: sessionGateway({
      info: { webId: WEBID, isLoggedIn: true },
      fetch,
    } as unknown as Session),
    store,
    gets,
  };
}

Deno.test("buildSharingEventTurtle round-trips through parseSharingEvents (grant)", () => {
  const e: SharingEvent = {
    type: "grant",
    owner: OWNER,
    grantee: BOB,
    resource: B1,
    kind: "Building",
    includesEnergy: true,
    at: "2026-06-04T10:00:00Z",
  };
  const ttl = buildSharingEventTurtle(e);
  const events = parseSharingEvents(new Store(new Parser({ baseIRI: B1 }).parse(ttl)));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], e);
});

Deno.test("buildSharingEventTurtle round-trips a per-year grant's years", () => {
  const e: SharingEvent = {
    type: "grant",
    owner: OWNER,
    grantee: BOB,
    resource: B1,
    kind: "Building",
    includesEnergy: true,
    years: [2023, 2024],
    at: "2026-06-04T10:00:00Z",
  };
  const ttl = buildSharingEventTurtle(e);
  assert.ok(ttl.includes('interop:includesEnergyYear "2023"^^xsd:gYear'));
  const events = parseSharingEvents(new Store(new Parser({ baseIRI: B1 }).parse(ttl)));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], e);
});

Deno.test("buildSharingEventTurtle round-trips a per-attachment grant's URIs", () => {
  const A1 = "https://alice.example/granergize/buildings/b1/files/plan.pdf";
  const A2 = "https://alice.example/granergize/buildings/b1/files/lease.pdf";
  const e: SharingEvent = {
    type: "grant",
    owner: OWNER,
    grantee: BOB,
    resource: B1,
    kind: "Building",
    includesEnergy: false,
    attachmentUris: [A1, A2],
    at: "2026-06-04T10:00:00Z",
  };
  const ttl = buildSharingEventTurtle(e);
  assert.ok(ttl.includes(`interop:includesAttachment <${A1}>`));
  assert.ok(ttl.includes(`interop:includesAttachment <${A2}>`));
  const events = parseSharingEvents(new Store(new Parser({ baseIRI: B1 }).parse(ttl)));
  assert.equal(events.length, 1);
  // attachmentUris parse back sorted; the fixture is already in sorted order? No:
  // A2 (lease) < A1 (plan) lexically, so assert the parsed set, order-independent.
  assert.deepEqual([...(events[0].attachmentUris ?? [])].sort(), [A1, A2].sort());
  assert.equal(events[0].includesEnergy, false);
});

Deno.test("buildSharingEventTurtle: absence ⇒ no includesAttachment / undefined attachmentUris", () => {
  const e: SharingEvent = {
    type: "grant",
    owner: OWNER,
    grantee: BOB,
    resource: B1,
    kind: "Building",
    includesEnergy: true,
    at: "2026-06-04T10:00:00Z",
  };
  const ttl = buildSharingEventTurtle(e);
  assert.ok(!ttl.includes("includesAttachment"), "no attachment triple emitted");
  const events = parseSharingEvents(new Store(new Parser({ baseIRI: B1 }).parse(ttl)));
  assert.equal(events.length, 1);
  assert.equal(events[0].attachmentUris, undefined);
});

Deno.test("buildSharingEventTurtle round-trips a revocation (no kind/energy)", () => {
  const e: SharingEvent = {
    type: "revocation",
    owner: OWNER,
    grantee: BOB,
    resource: B1,
    at: "2026-06-05T10:00:00Z",
  };
  const ttl = buildSharingEventTurtle(e);
  const events = parseSharingEvents(new Store(new Parser({ baseIRI: B1 }).parse(ttl)));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "revocation");
  assert.equal(events[0].kind, undefined);
  assert.equal(events[0].includesEnergy, undefined);
});

Deno.test("foldSharingLog: a lone grant is active", async () => {
  const { session } = makePod();
  const log = sharedInUri(WEBID);
  await appendSharingEvent(log, session, {
    type: "grant", owner: OWNER, grantee: WEBID, resource: B1, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  const active = await foldSharingLog(log, session);
  assert.equal(active.length, 1);
  assert.equal(active[0].resource, B1);
  assert.equal(active[0].owner, OWNER);
});

Deno.test("foldSharingLog: a later revocation drops the pair", async () => {
  const { session } = makePod();
  const log = sharedInUri(WEBID);
  await appendSharingEvent(log, session, {
    type: "grant", owner: OWNER, grantee: WEBID, resource: B1, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "revocation", owner: OWNER, grantee: WEBID, resource: B1,
    at: "2026-06-06T10:00:00Z",
  });
  assert.deepEqual(await foldSharingLog(log, session), []);
});

Deno.test("foldSharingLog: a re-grant after a revocation is active again", async () => {
  const { session } = makePod();
  const log = sharedOutUri(WEBID);
  await appendSharingEvent(log, session, {
    type: "grant", owner: WEBID, grantee: BOB, resource: B1, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "revocation", owner: WEBID, grantee: BOB, resource: B1,
    at: "2026-06-05T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "grant", owner: WEBID, grantee: BOB, resource: B1, kind: "Building",
    at: "2026-06-06T10:00:00Z",
  });
  const active = await foldSharingLog(log, session);
  assert.equal(active.length, 1);
  assert.equal(active[0].grantee, BOB);
});

Deno.test("foldSharingLog: (grantee, resource) pairs fold independently", async () => {
  const { session } = makePod();
  const log = sharedOutUri(WEBID);
  // B1 → Bob active; B2 → Bob granted then revoked.
  await appendSharingEvent(log, session, {
    type: "grant", owner: WEBID, grantee: BOB, resource: B1, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "grant", owner: WEBID, grantee: BOB, resource: B2, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "revocation", owner: WEBID, grantee: BOB, resource: B2,
    at: "2026-06-05T10:00:00Z",
  });
  const active = await foldSharingLog(log, session);
  assert.deepEqual(active.map((g) => g.resource), [B1]);
});

Deno.test("foldSharingLog on a missing container is empty", async () => {
  const { session } = makePod();
  assert.deepEqual(await foldSharingLog(sharedInUri(WEBID), session), []);
});

Deno.test("foldSharingLog: a re-fold re-reads only the listing, not the immutable events", async () => {
  const { session, gets } = makePod();
  const log = sharedInUri(WEBID);
  await appendSharingEvent(log, session, {
    type: "grant", owner: OWNER, grantee: WEBID, resource: B1, kind: "Building",
    at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(log, session, {
    type: "grant", owner: OWNER, grantee: WEBID, resource: B2, kind: "Building",
    at: "2026-06-04T11:00:00Z",
  });

  assert.equal((await foldSharingLog(log, session)).length, 2);
  const eventGets = () => gets.filter((u) => !u.endsWith("/")).length;
  assert.equal(eventGets(), 2, "first fold reads each event once");

  // Events are immutable once POSTed: a second fold revalidates the container
  // listing but serves the parsed events from the per-session cache.
  assert.equal((await foldSharingLog(log, session)).length, 2);
  assert.equal(eventGets(), 2, "re-fold reads NO event resource again");
  assert.equal(gets.filter((u) => u === log).length, 2, "listing re-read");

  // A NEW event (here: a revocation) is the only one fetched on the next fold,
  // and the fold's result reflects it.
  await appendSharingEvent(log, session, {
    type: "revocation", owner: OWNER, grantee: WEBID, resource: B2,
    at: "2026-06-05T10:00:00Z",
  });
  const active = await foldSharingLog(log, session);
  assert.deepEqual(active.map((g) => g.resource), [B1]);
  assert.equal(eventGets(), 3, "only the new event was read");
});

Deno.test("cachedSharingGrants folds the warm cache (listing + per-event entries)", () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    const EVT = `${sharedOutUri(WEBID)}evt-1`;
    const grant: SharingEvent = {
      type: "grant",
      owner: WEBID,
      grantee: BOB,
      resource: B1,
      at: "2026-01-01T00:00:00Z",
      kind: "Building",
    };
    qc.setQueryData<string[]>(["sharedOutContainer", WEBID], [EVT]);
    qc.setQueryData<SharingEvent[]>(["sharingEvent", WEBID, EVT], [grant]);
    const grants = cachedSharingGrants(WEBID, "sharedOutContainer");
    assert.equal(grants?.length, 1);
    assert.equal(grants?.[0].resource, B1);
    assert.equal(grants?.[0].grantee, BOB);

    // A listed event that isn't cached → null (don't trust a partial fold).
    qc.setQueryData<string[]>(["sharedOutContainer", WEBID], [EVT, `${EVT}-2`]);
    assert.equal(cachedSharingGrants(WEBID, "sharedOutContainer"), null);
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});

Deno.test("cachedSharingGrants: no app client / cold listing → null", () => {
  _setAppQueryClient(null);
  assert.equal(cachedSharingGrants(WEBID, "sharedInContainer"), null);
});
