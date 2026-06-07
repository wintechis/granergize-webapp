/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { reissueGrants } from "./share.ts";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";
import { GRAN_NS } from "../utils/vocabularies.ts";

// Owner Pod at https://a.example/ ; recipients live elsewhere.
const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);

const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const SHARED_OUT = `${ROOT}granergize/shared-out/`;
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
const ENERGY = `${ROOT}granergize/buildings/b-1/energy`;
const SNAPSHOT = `${ROOT}granergize/views/snapshots/v-1.ttl`;
// A grant whose resource is on someone else's Pod — must be skipped on replay.
const OFFPOD = "https://other.example/granergize/buildings/x.ttl";

const BUILDING_TTL = `
@prefix gran: <${GRAN_NS}> .
<${BUILDING}#b-1>
  gran:hasEnergyDataset <${ENERGY}/2024-P1Y.ttl#ds> ,
                        <${ENERGY}/2023-P1Y.ttl#ds> .
`;

/** One shared-out event resource (subject `<>`), the grant shape we log. */
function grantTtl(
  grantee: string,
  resource: string,
  kind: "Building" | "View",
  at: string,
  years?: number[],
): string {
  const yearTriples = (years ?? [])
    .map((y) => `   interop:includesEnergyYear "${y}"^^xsd:gYear ;`)
    .join("\n");
  return `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix gran: <${GRAN_NS}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessGrant ;
   prov:wasAssociatedWith <${WEBID}> ;
   interop:grantee <${grantee}> ;
   interop:forResource <${resource}> ;
   interop:accessMode acl:Read ;
   gran:kind gran:${kind} ;
${yearTriples}
   prov:generatedAtTime "${at}"^^xsd:dateTime .
`;
}

interface Call {
  url: string;
  method: string;
}

/**
 * Stateful fake Pod: GET reads the store, PUT/POST write it (recording every
 * call). The shared-out container lists its event children via `ldp:contains`.
 */
function makePod(): { session: Session; store: Record<string, string>; calls: Call[] } {
  const ev1 = `${SHARED_OUT}e1`;
  const ev2 = `${SHARED_OUT}e2`;
  const ev3 = `${SHARED_OUT}e3`;
  const store: Record<string, string> = {
    [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${SHARED_OUT}> ldp:contains <${ev1}>, <${ev2}>, <${ev3}> .`,
    [ev1]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z", [2024]),
    [ev2]: grantTtl(CAROL, SNAPSHOT, "View", "2026-06-04T11:00:00Z"),
    [ev3]: grantTtl(BOB, OFFPOD, "Building", "2026-06-04T12:00:00Z"),
    [BUILDING]: BUILDING_TTL,
  };
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[url] = String(init.body);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "HEAD") {
      return Promise.resolve(new Response("", { status: url in store ? 200 : 404 }));
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: { info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session,
    store,
    calls,
  };
}

Deno.test("reissueGrants replays the folded log: building + view ACLs, skips off-Pod", async () => {
  const { session, store } = makePod();
  const result = await reissueGrants(session);

  assert.equal(result.buildings, 1, "one building grant replayed");
  assert.equal(result.views, 1, "one view grant replayed");
  assert.equal(result.skipped, 1, "off-Pod grant skipped");

  // Building file + view snapshot ACLs were written with the recipient.
  assert.ok(store[`${BUILDING}.acl`]?.includes(BOB), "building .acl grants Bob");
  assert.ok(store[`${SNAPSHOT}.acl`]?.includes(CAROL), "snapshot .acl grants Carol");

  // Per-year scope honoured: 2024 dataset granted, 2023 NOT.
  assert.ok(store[`${ENERGY}/2024-P1Y.ttl.acl`]?.includes(BOB), "2024 dataset granted");
  assert.ok(!(`${ENERGY}/2023-P1Y.ttl.acl` in store), "2023 dataset not granted");

  // The off-Pod resource's ACL was never touched.
  assert.ok(!(`${OFFPOD}.acl` in store), "off-Pod ACL untouched");
});

Deno.test("reissueGrants is record-free: no inbox POST, no shared-out/ append", async () => {
  const { session, calls } = makePod();
  await reissueGrants(session);

  // No event was appended to the log (POST to the shared-out container).
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url === SHARED_OUT),
    "no new shared-out/ event appended",
  );
  // No request to any recipient inbox (reissue never notifies).
  assert.ok(
    !calls.some((c) => c.url.includes("bob.example") || c.url.includes("carol.example")),
    "no recipient inbox/notify traffic",
  );
});

Deno.test("reissueGrants throws when not logged in", async () => {
  const session = { info: { isLoggedIn: false, webId: undefined } } as unknown as Session;
  await assert.rejects(() => reissueGrants(session), /not logged in/i);
});
