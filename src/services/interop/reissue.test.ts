/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { auditGrants, reconcileBuildingGrants, reissueGrants } from "./share.ts";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";
import {
  CONSUMPTION_NS,
  GRAN_NS,
  REC_BUILDING,
} from "../rdf/vocabularies.ts";

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
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${ENERGY}/2024-P1Y.ttl#ds> ,
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
   gran:kind <${kind === "Building" ? REC_BUILDING : `${CONSUMPTION_NS}View`}> ;
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
    // The granted resources exist on the Pod (reissue HEADs each before
    // re-applying, so a deleted resource isn't resurrected — tested below).
    [SNAPSHOT]: `<${SNAPSHOT}#snapshot> a <${CONSUMPTION_NS}AggregatedViewSnapshot> .`,
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

/** One shared-out revocation event resource (no kind/mode — matches revokeAccess). */
function revocationTtl(grantee: string, resource: string, at: string): string {
  return `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessRevocation ;
   prov:wasAssociatedWith <${WEBID}> ;
   interop:grantee <${grantee}> ;
   interop:forResource <${resource}> ;
   prov:generatedAtTime "${at}"^^xsd:dateTime .
`;
}

/** A pre-existing building .acl: the owner (Control) + Carol (Read). */
const STALE_ACL = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner> a acl:Authorization ;
  acl:agent <${WEBID}> ;
  acl:accessTo <${BUILDING}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#carol> a acl:Authorization ;
  acl:agent <${CAROL}> ;
  acl:accessTo <${BUILDING}> ;
  acl:mode acl:Read .
`;

/** Pod with a custom event list (and optional extra resources). */
function makePodWith(
  events: Record<string, string>,
  extra: Record<string, string> = {},
): { session: Session; store: Record<string, string>; calls: Call[] } {
  const refs = Object.keys(events).map((u) => `<${u}>`).join(", ");
  const store: Record<string, string> = {
    [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${SHARED_OUT}> ldp:contains ${refs} .`,
    ...events,
    ...extra,
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

Deno.test("reissueGrants replays revocations: a revoked-in-log recipient is withdrawn from the ACL", async () => {
  // The drift this repairs: revokeAccess appended its event but the ACL write
  // failed — the log says revoked, the .acl still grants. Replay withdraws it.
  const { session, store } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: revocationTtl(CAROL, BUILDING, "2026-06-05T10:00:00Z"),
    },
    { [BUILDING]: BUILDING_TTL, [`${BUILDING}.acl`]: STALE_ACL },
  );
  const result = await reissueGrants(session);

  assert.equal(result.buildings, 1, "Bob's active grant replayed");
  assert.equal(result.revoked, 1, "Carol's revocation replayed");
  const acl = store[`${BUILDING}.acl`] ?? "";
  assert.ok(!acl.includes(CAROL), "Carol's authorization withdrawn");
  assert.ok(acl.includes(WEBID), "the owner's Control authorization survives");
  assert.ok(acl.includes(BOB), "Bob's re-applied grant present");
});

// ── reconcileBuildingGrants — extend grown scopes on the write path ─────────────

Deno.test("reconcileBuildingGrants extends an all-years grant to a dataset written after the share", async () => {
  // The QUESTIONS.md gap, closed: the grant event records "all years"
  // (intensional), the .acl was enumerated at share time (extensional). After
  // the building gains the 2024 dataset, reconcile must re-derive the
  // projection so Bob's grant covers it — and stay record-free (no new event,
  // no inbox traffic: the logged event already covers the scope).
  const { session, store, calls } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
    },
    { [BUILDING]: BUILDING_TTL }, // links 2023 AND 2024 — 2024 is the new one
  );
  const applied = await reconcileBuildingGrants(BUILDING, session);

  assert.equal(applied, 1, "one active grant re-applied");
  assert.ok(store[`${ENERGY}/2024-P1Y.ttl.acl`]?.includes(BOB), "new dataset granted to Bob");
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url === SHARED_OUT),
    "no new shared-out/ event appended",
  );
  assert.ok(
    !calls.some((c) => c.url.includes("bob.example")),
    "no recipient inbox/notify traffic",
  );
  const after = await auditGrants(session);
  assert.equal(after.drift.length, 0, "projection matches the log after reconcile");
});

Deno.test("reconcileBuildingGrants honours a per-year scope: the new year stays outside it", async () => {
  const { session, store } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z", [2023]),
    },
    { [BUILDING]: BUILDING_TTL },
  );
  const applied = await reconcileBuildingGrants(BUILDING, session);

  assert.equal(applied, 1, "the per-year grant is re-applied (its own years)");
  assert.ok(store[`${ENERGY}/2023-P1Y.ttl.acl`]?.includes(BOB), "recorded year granted");
  assert.ok(
    !(`${ENERGY}/2024-P1Y.ttl.acl` in store),
    "the year outside the recorded scope is NOT granted",
  );
});

Deno.test("reconcileBuildingGrants ignores revoked pairs, other buildings and views", async () => {
  const OTHER = `${ROOT}granergize/buildings/b-2.ttl`;
  const { session, calls } = makePodWith(
    {
      // Bob's grant on THIS building was revoked — nothing to extend.
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: revocationTtl(BOB, BUILDING, "2026-06-05T10:00:00Z"),
      // Carol's grants target a different building / a view.
      [`${SHARED_OUT}e3`]: grantTtl(CAROL, OTHER, "Building", "2026-06-04T11:00:00Z"),
      [`${SHARED_OUT}e4`]: grantTtl(CAROL, SNAPSHOT, "View", "2026-06-04T12:00:00Z"),
    },
    { [BUILDING]: BUILDING_TTL, [OTHER]: BUILDING_TTL, [SNAPSHOT]: "<#s> a <x:S> ." },
  );
  const writesBefore = calls.filter((c) => c.method === "PUT").length;
  const applied = await reconcileBuildingGrants(BUILDING, session);

  assert.equal(applied, 0, "no active grant on this building");
  assert.equal(
    calls.filter((c) => c.method === "PUT").length,
    writesBefore,
    "an unshared (or fully-revoked) building reconciles to zero writes",
  );
});

// ── auditGrants — the dry-run diffing twin ──────────────────────────────────────

Deno.test("auditGrants reports missing grants for an event-without-ACL, and is clean after the repair", async () => {
  // The same pod the replay test uses: grant events exist, no .acl was ever
  // written (the archive-restore shape). The audit must surface every expected
  // target as missing-grant — WITHOUT writing anything — and a subsequent
  // reissueGrants must bring the diff to empty (audit as post-repair verification).
  const { session, store, calls } = makePod();

  const before = await auditGrants(session);
  assert.equal(before.skipped, 1, "off-Pod grant skipped, like the replay");
  assert.ok(before.drift.length > 0, "drift found before the repair");
  assert.ok(
    before.drift.every((d) => d.kind === "missing-grant"),
    "all drift is missing-grant",
  );
  // Bob's per-year ([2024]) building grant: the building file and the 2024
  // dataset are expected; 2023 is OUTSIDE the recorded scope, so its absence
  // is NOT drift.
  const bobResources = before.drift.filter((d) => d.grantee === BOB).map((d) => d.resource);
  assert.ok(bobResources.includes(BUILDING), "building file missing for Bob");
  assert.ok(bobResources.includes(`${ENERGY}/2024-P1Y.ttl`), "2024 dataset missing for Bob");
  assert.ok(
    !bobResources.includes(`${ENERGY}/2023-P1Y.ttl`),
    "2023 is outside the per-year scope — not drift",
  );
  assert.ok(
    before.drift.some((d) => d.grantee === CAROL && d.resource === SNAPSHOT),
    "Carol's view snapshot missing",
  );
  // Dry run: the audit wrote nothing.
  assert.ok(
    !calls.some((c) => c.method === "PUT" || c.method === "POST" || c.method === "DELETE"),
    "auditGrants performs no writes",
  );

  await reissueGrants(session);
  const after = await auditGrants(session);
  assert.equal(after.drift.length, 0, "diff empty after the repair");
  assert.ok(after.checked >= before.checked, "same pairs re-checked");
  assert.ok(`${BUILDING}.acl` in store, "repair actually wrote the ACLs");
});

Deno.test("auditGrants reports a lingering grant for a revoked-in-log recipient", async () => {
  // The other drift direction: the log says revoked, the .acl still grants
  // (a revoke whose ACL write failed). Carol must show up as lingering-grant;
  // Bob's intact grant must not.
  const { session, calls } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: revocationTtl(CAROL, BUILDING, "2026-06-05T10:00:00Z"),
    },
    { [BUILDING]: BUILDING_TTL, [`${BUILDING}.acl`]: STALE_ACL },
  );
  const result = await auditGrants(session);

  const lingering = result.drift.filter((d) => d.kind === "lingering-grant");
  assert.ok(
    lingering.some((d) => d.grantee === CAROL && d.resource === BUILDING),
    `Carol lingers on the building — drift=${JSON.stringify(result.drift)}`,
  );
  assert.ok(
    !result.drift.some((d) => d.grantee === BOB && d.kind === "lingering-grant"),
    "Bob's active grant is not lingering",
  );
  assert.ok(
    !calls.some((c) => c.method === "PUT" || c.method === "POST" || c.method === "DELETE"),
    "auditGrants performs no writes",
  );
});

Deno.test("auditGrants counts a deleted resource as missing, not drift", async () => {
  const GONE = `${ROOT}granergize/buildings/deleted.ttl`;
  const { session } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, GONE, "Building", "2026-06-04T10:00:00Z"),
    },
    {}, // the building file is NOT in the store → HEAD 404
  );
  const result = await auditGrants(session);
  assert.equal(result.missing, 1, "deleted-resource grant counted missing");
  assert.equal(result.drift.length, 0, "a deleted resource is not drift");
});

Deno.test("reissueGrants skips a grant whose resource was deleted (no ghost containers)", async () => {
  // A dangling active grant (delete-building whose pre-delete revoke pass
  // failed) must not be re-applied: that would recreate empty containers and
  // orphan .acl files for a resource that no longer exists.
  const GONE = `${ROOT}granergize/buildings/deleted.ttl`;
  const { session, store, calls } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, GONE, "Building", "2026-06-04T10:00:00Z"),
    },
    {}, // the building file is NOT in the store → HEAD 404
  );
  const result = await reissueGrants(session);

  assert.equal(result.missing, 1, "deleted-resource grant counted as missing");
  assert.equal(result.buildings, 0, "nothing replayed");
  assert.ok(!(`${GONE}.acl` in store), "no orphan .acl written");
  const goneDir = GONE.replace(/\.ttl$/, "/");
  assert.ok(
    !calls.some((c) => c.method === "PUT" && c.url.startsWith(goneDir)),
    "no container resurrected under the deleted building",
  );
});
