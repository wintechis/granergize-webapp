/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../pod/podGateway.ts";
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  applyBuildingGrant,
  auditGrants,
  reconcileBuildingGrants,
  reissueGrants,
} from "./share.ts";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";
import {
  BUILDING_NS,
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
const OBS = `${ROOT}granergize/observations`;
// Time-first dataset descriptors (fixed stems for the test).
const DS_2024 = `${OBS}/2024/d1.ttl`;
const DS_2023 = `${OBS}/2023/d2.ttl`;
const SNAPSHOT = `${ROOT}granergize/aggregations/snapshots/v-1.ttl`;
// A grant whose resource is on someone else's Pod — must be skipped on replay.
const OFFPOD = "https://other.example/granergize/buildings/x.ttl";

const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${DS_2024}#ds> ,
                        <${DS_2023}#ds> .
<${DS_2024}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
<${DS_2023}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

/** One shared-out event resource (subject `<>`), the grant shape we log. */
function grantTtl(
  grantee: string,
  resource: string,
  kind: "Building" | "Aggregation",
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
   gran:kind <${kind === "Building" ? REC_BUILDING : `${CONSUMPTION_NS}Aggregation`}> ;
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
function makePod(): { session: PodGateway; store: Record<string, string>; calls: Call[] } {
  const ev1 = `${SHARED_OUT}e1`;
  const ev2 = `${SHARED_OUT}e2`;
  const ev3 = `${SHARED_OUT}e3`;
  const store: Record<string, string> = {
    [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${SHARED_OUT}> ldp:contains <${ev1}>, <${ev2}>, <${ev3}> .`,
    [ev1]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z", [2024]),
    [ev2]: grantTtl(CAROL, SNAPSHOT, "Aggregation", "2026-06-04T11:00:00Z"),
    [ev3]: grantTtl(BOB, OFFPOD, "Building", "2026-06-04T12:00:00Z"),
    [BUILDING]: BUILDING_TTL,
    // The granted resources exist on the Pod (reissue HEADs each before
    // re-applying, so a deleted resource isn't resurrected — tested below).
    [SNAPSHOT]: `<${SNAPSHOT}#snapshot> a <${CONSUMPTION_NS}AggregationSnapshot> .`,
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
    session: sessionGateway({ info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session),
    store,
    calls,
  };
}

Deno.test("reissueGrants replays the folded log: building + aggregation ACLs, skips off-Pod", async () => {
  const { session, store } = makePod();
  const result = await reissueGrants(session);

  assert.equal(result.buildings, 1, "one building grant replayed");
  assert.equal(result.aggregations, 1, "one aggregation grant replayed");
  assert.equal(result.skipped, 1, "off-Pod grant skipped");

  // Building file + aggregation snapshot ACLs were written with the recipient.
  assert.ok(store[`${BUILDING}.acl`]?.includes(BOB), "building .acl grants Bob");
  assert.ok(store[`${SNAPSHOT}.acl`]?.includes(CAROL), "snapshot .acl grants Carol");

  // Per-year scope honoured: 2024 dataset granted, 2023 NOT.
  assert.ok(store[`${DS_2024}.acl`]?.includes(BOB), "2024 dataset granted");
  assert.ok(!(`${DS_2023}.acl` in store), "2023 dataset not granted");

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
  const session = sessionGateway({ info: { isLoggedIn: false, webId: undefined } } as unknown as Session);
  await assert.rejects(() => reissueGrants(session), /not logged in/i);
});

/** One shared-out revocation event resource (kind optional — a kind-less one is legacy). */
function revocationTtl(
  grantee: string,
  resource: string,
  at: string,
  kind?: "Building" | "Aggregation",
): string {
  const kindTriple = kind
    ? `   gran:kind <${kind === "Building" ? REC_BUILDING : `${CONSUMPTION_NS}Aggregation`}> ;\n`
    : "";
  return `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix gran: <${GRAN_NS}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessRevocation ;
   prov:wasAssociatedWith <${WEBID}> ;
   interop:grantee <${grantee}> ;
   interop:forResource <${resource}> ;
${kindTriple}   prov:generatedAtTime "${at}"^^xsd:dateTime .
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
): { session: PodGateway; store: Record<string, string>; calls: Call[] } {
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
    session: sessionGateway({ info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session),
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
  assert.ok(store[`${DS_2024}.acl`]?.includes(BOB), "new dataset granted to Bob");
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
  assert.ok(store[`${DS_2023}.acl`]?.includes(BOB), "recorded year granted");
  assert.ok(
    !(`${DS_2024}.acl` in store),
    "the year outside the recorded scope is NOT granted",
  );
});

Deno.test("reconcileBuildingGrants ignores revoked pairs, other buildings and aggregations", async () => {
  const OTHER = `${ROOT}granergize/buildings/b-2.ttl`;
  const { session, calls } = makePodWith(
    {
      // Bob's grant on THIS building was revoked — nothing to extend.
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: revocationTtl(BOB, BUILDING, "2026-06-05T10:00:00Z"),
      // Carol's grants target a different building / an aggregation.
      [`${SHARED_OUT}e3`]: grantTtl(CAROL, OTHER, "Building", "2026-06-04T11:00:00Z"),
      [`${SHARED_OUT}e4`]: grantTtl(CAROL, SNAPSHOT, "Aggregation", "2026-06-04T12:00:00Z"),
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
  assert.ok(bobResources.includes(`${DS_2024}`), "2024 dataset missing for Bob");
  assert.ok(
    !bobResources.includes(`${DS_2023}`),
    "2023 is outside the per-year scope — not drift",
  );
  assert.ok(
    before.drift.some((d) => d.grantee === CAROL && d.resource === SNAPSHOT),
    "Carol's aggregation snapshot missing",
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

// ── Narrowed re-shares — the projection must CONVERGE, not only widen ──────────
// The fold keeps the LATEST event per (grantee, resource) pair, so a re-share
// with a smaller scope makes the narrow scope the log's whole truth. The ACL
// projection must follow: targets only the previous, wider grant covered have
// to be withdrawn — by the apply itself, by the log replay, and visibly in the
// audit.

const FILES = `${ROOT}granergize/buildings/b-1/files/`;
const ATT_A = `${FILES}a.pdf`;
const ATT_B = `${FILES}b.pdf`;

const BUILDING_WITH_ATTACHMENTS_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
@prefix bldg: <${BUILDING_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${DS_2024}#ds> ,
                        <${DS_2023}#ds> ;
  bldg:hasAttachment <${ATT_A}> , <${ATT_B}> .
<${DS_2024}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
<${DS_2023}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

/** A dataset .acl left by an earlier, wider share: the owner (Control) + Bob (Read). */
function staleAcl(resource: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner> a acl:Authorization ;
  acl:agent <${WEBID}> ;
  acl:accessTo <${resource}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#bob> a acl:Authorization ;
  acl:agent <${BOB}> ;
  acl:accessTo <${resource}> ;
  acl:mode acl:Read .
`;
}

Deno.test("applyBuildingGrant withdraws the years a narrowed re-share dropped", async () => {
  const { session, store } = makePodWith({}, { [BUILDING]: BUILDING_TTL });
  await applyBuildingGrant(BUILDING, BOB, session); // all years
  assert.ok(store[`${DS_2024}.acl`]?.includes(BOB), "wide share granted 2024");
  assert.ok(store[`${DS_2023}.acl`]?.includes(BOB), "wide share granted 2023");

  await applyBuildingGrant(BUILDING, BOB, session, {
    includeEnergyData: true,
    years: [2023],
  });
  assert.ok(
    !store[`${DS_2024}.acl`]?.includes(BOB),
    "the dropped year's ACL is withdrawn",
  );
  assert.ok(
    store[`${DS_2024}.acl`]?.includes(WEBID),
    "the owner's Control authorization survives the withdrawal",
  );
  assert.ok(store[`${DS_2023}.acl`]?.includes(BOB), "the kept year stays granted");
  assert.ok(store[`${BUILDING}.acl`]?.includes(BOB), "the building file stays granted");
});

Deno.test("applyBuildingGrant narrowing to an attachment subset withdraws the files/ container default", async () => {
  const { session, store } = makePodWith(
    {},
    { [BUILDING]: BUILDING_WITH_ATTACHMENTS_TTL },
  );
  await applyBuildingGrant(BUILDING, BOB, session); // all attachments (container default)
  assert.ok(store[`${FILES}.acl`]?.includes(BOB), "wide share granted the container");

  await applyBuildingGrant(BUILDING, BOB, session, {
    includeEnergyData: true,
    attachmentUris: [ATT_A],
  });
  assert.ok(
    !store[`${FILES}.acl`]?.includes(BOB),
    "the container default is withdrawn — unselected binaries unreadable again",
  );
  assert.ok(store[`${ATT_A}.acl`]?.includes(BOB), "the selected file granted individually");
  assert.ok(!store[`${ATT_B}.acl`]?.includes(BOB), "the unselected file is not granted");

  // Widening back to all folds the individual grant into the container default.
  await applyBuildingGrant(BUILDING, BOB, session);
  assert.ok(store[`${FILES}.acl`]?.includes(BOB), "the container default is re-granted");
  assert.ok(
    !store[`${ATT_A}.acl`]?.includes(BOB),
    "the stale individual grant is withdrawn (covered by the container)",
  );
});

Deno.test("applyBuildingGrant withdraws every dataset when a re-share drops energy", async () => {
  const { session, store } = makePodWith({}, { [BUILDING]: BUILDING_TTL });
  await applyBuildingGrant(BUILDING, BOB, session);
  await applyBuildingGrant(BUILDING, BOB, session, { includeEnergyData: false });

  assert.ok(!store[`${DS_2024}.acl`]?.includes(BOB), "2024 dataset withdrawn");
  assert.ok(!store[`${DS_2023}.acl`]?.includes(BOB), "2023 dataset withdrawn");
  assert.ok(
    store[`${BUILDING}.acl`]?.includes(BOB),
    "the master-data grant itself stays",
  );
});

Deno.test("reissueGrants converges a narrowed grant: the dropped year's lingering ACL is withdrawn", async () => {
  // The wide share's ACL write succeeded, then the owner re-shared 2023-only.
  // The fold's latest event IS the narrow scope, so replay must withdraw 2024.
  const { session, store } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: grantTtl(BOB, BUILDING, "Building", "2026-06-05T10:00:00Z", [2023]),
    },
    { [BUILDING]: BUILDING_TTL, [`${DS_2024}.acl`]: staleAcl(DS_2024) },
  );
  await reissueGrants(session);

  assert.ok(
    !store[`${DS_2024}.acl`]?.includes(BOB),
    "the lingering out-of-scope year is withdrawn on replay",
  );
  assert.ok(store[`${DS_2023}.acl`]?.includes(BOB), "the recorded scope is granted");
});

Deno.test("auditGrants reports lingering-grant for a target outside a narrowed ACTIVE grant", async () => {
  // Same drift, observed instead of repaired: the log's latest grant says 2023
  // only, the 2024 .acl still grants Bob. That must be visible as
  // lingering-grant (not only for revocations), and clean after the repair.
  const { session, calls } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(BOB, BUILDING, "Building", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: grantTtl(BOB, BUILDING, "Building", "2026-06-05T10:00:00Z", [2023]),
    },
    { [BUILDING]: BUILDING_TTL, [`${DS_2024}.acl`]: staleAcl(DS_2024) },
  );
  const before = await auditGrants(session);
  assert.ok(
    before.drift.some((d) =>
      d.kind === "lingering-grant" && d.grantee === BOB && d.resource === DS_2024
    ),
    `2024 lingers outside the active grant's scope — drift=${JSON.stringify(before.drift)}`,
  );
  assert.ok(
    !calls.some((c) => c.method === "PUT" || c.method === "POST" || c.method === "DELETE"),
    "auditGrants performs no writes",
  );

  await reissueGrants(session);
  const after = await auditGrants(session);
  assert.equal(after.drift.length, 0, "projection matches the log after the repair");
});

Deno.test("revocation replay dispatches by KIND: an aggregation revocation fabricates no building targets", async () => {
  // The event records what was revoked. Without the kind, the replay (and the
  // audit twin) sent every revocation down the building path — deriving a
  // building-shaped files/ container for a snapshot file and probing ACLs that
  // can't exist. With the kind on the event, only the snapshot's own ACL is
  // withdrawn.
  const CAROL_ACL = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner> a acl:Authorization ;
  acl:agent <${WEBID}> ;
  acl:accessTo <${SNAPSHOT}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#carol> a acl:Authorization ;
  acl:agent <${CAROL}> ;
  acl:accessTo <${SNAPSHOT}> ;
  acl:mode acl:Read .
`;
  const { session, store, calls } = makePodWith(
    {
      [`${SHARED_OUT}e1`]: grantTtl(CAROL, SNAPSHOT, "Aggregation", "2026-06-04T10:00:00Z"),
      [`${SHARED_OUT}e2`]: revocationTtl(CAROL, SNAPSHOT, "2026-06-05T10:00:00Z", "Aggregation"),
    },
    {
      [SNAPSHOT]: `<${SNAPSHOT}#snapshot> a <${CONSUMPTION_NS}AggregationSnapshot> .`,
      [`${SNAPSHOT}.acl`]: CAROL_ACL,
    },
  );
  const result = await reissueGrants(session);
  assert.equal(result.revoked, 1, "the aggregation revocation is replayed");
  assert.ok(!store[`${SNAPSHOT}.acl`]?.includes(CAROL), "Carol withdrawn from the snapshot");

  await auditGrants(session);
  // The snapshot is `…/snapshots/v-1.ttl`; a building-dispatched revocation
  // would derive and probe `…/snapshots/v-1/files/` (+ its .acl).
  const fabricated = calls.filter((c) => c.url.includes("/snapshots/v-1/"));
  assert.deepEqual(
    fabricated,
    [],
    "neither replay nor audit fabricates building-shaped sub-resources for a snapshot",
  );
});
