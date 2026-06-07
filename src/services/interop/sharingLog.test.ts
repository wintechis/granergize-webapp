/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";
import {
  appendSharingEvent,
  buildSharingEventTurtle,
  foldSharingLog,
  parseSharingEvents,
  sharedInUrl,
  sharedOutUrl,
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
function makePod(): { session: Session; store: Record<string, string> } {
  const store: Record<string, string> = {};
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
    session: {
      info: { webId: WEBID, isLoggedIn: true },
      fetch,
    } as unknown as Session,
    store,
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
  const log = sharedInUrl(WEBID);
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
  const log = sharedInUrl(WEBID);
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
  const log = sharedOutUrl(WEBID);
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
  const log = sharedOutUrl(WEBID);
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
  assert.deepEqual(await foldSharingLog(sharedInUrl(WEBID), session), []);
});
