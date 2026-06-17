/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
//
// Tier-1 proof that the invoke/query entry point is callable HEADLESS: it is
// driven directly with a fake offline-fixture Session — no React, no renderHook,
// no QueryClientProvider — dispatching to the extracted cores. Also pins CQS at
// the type level (the @ts-expect-error lines) and the no-core error.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  IntentNotInvocableError,
  invoke,
  invokeByName,
  query,
} from "./registry.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { CONSUMPTION_NS, GRAN_NS, REC_BUILDING } from "../services/rdf/vocabularies.ts";

const OWNER = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
const SHARED_OUT = `${ROOT}granergize/shared-out/`;
const GRAN_DIR = `${ROOT}granergize/`;
const BOB = "https://bob.example/profile/card#me";
const BOB_INBOX = "https://bob.example/granergize/inbox/";

const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1> a <${REC_BUILDING}> .
`;

interface Call {
  url: string;
  method: string;
}

/**
 * Stateful fake two-Pod world for the write path (ShareBuilding): the owner's
 * building + shared-out/ on a.example, Bob's profile (so inbox discovery resolves
 * his storage root) and inbox elsewhere. Records every call.
 */
function sharePod(): { session: PodGateway; calls: Call[] } {
  _setStorageRootForTesting(OWNER, ROOT);
  const store: Record<string, string> = {
    [BUILDING]: BUILDING_TTL,
    ["https://bob.example/profile/card"]:
      `@prefix pim: <http://www.w3.org/ns/pim/space#> .\n<${BOB}> pim:storage <https://bob.example/> .`,
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
  };
}

/** One shared-out grant event resource (subject `<>`). */
function grantTtl(grantee: string, resource: string, at: string): string {
  return `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix gran: <${GRAN_NS}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessGrant ;
   prov:wasAssociatedWith <${OWNER}> ;
   interop:grantee <${grantee}> ;
   interop:forResource <${resource}> ;
   interop:accessMode acl:Read ;
   gran:kind <${REC_BUILDING}> ;
   prov:generatedAtTime "${at}"^^xsd:dateTime .
`;
}

/**
 * Read-path fake Pod: a shared-out grant with NO matching .acl (→ drift), and a
 * small app collection listing so ExportArchive packs at least one resource.
 */
function readPod(): { session: PodGateway } {
  _setStorageRootForTesting(OWNER, ROOT);
  const ev1 = `${SHARED_OUT}e1`;
  const store: Record<string, string> = {
    [GRAN_DIR]:
      `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${GRAN_DIR}> ldp:contains <${BUILDING}> .`,
    [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${SHARED_OUT}> ldp:contains <${ev1}> .`,
    [ev1]: grantTtl(BOB, BUILDING, "2026-06-04T10:00:00Z"),
    [BUILDING]: BUILDING_TTL,
  };
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return Promise.resolve(new Response("", { status: url in store ? 200 : 404 }));
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return { session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session) };
}

Deno.test("invoke('ShareBuilding', …) dispatches to the write core: tally + Pod writes", async () => {
  const { session, calls } = sharePod();

  const outcome = await invoke("ShareBuilding", {
    buildingUri: `${BUILDING}#b-1`,
    recipients: [BOB],
    includeEnergyData: false,
  }, session);

  // The write OUTCOME (a per-recipient tally) comes back through invoke().
  assert.deepEqual(outcome, { recipientsShared: 1 });
  // The core's Pod-request composition ran: one grant event + the recipient inbox.
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.url === SHARED_OUT).length,
    1,
    "one grant event appended to shared-out/",
  );
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.url === BOB_INBOX).length,
    1,
    "recipient inbox notified once",
  );
});

Deno.test("query('AuditGrants', {}, …) dispatches to the read core and returns its value", async () => {
  const { session } = readPod();

  const report = await query("AuditGrants", {}, session);

  // The read VALUE (the drift report) comes back through query().
  assert.ok(report.checked >= 1, "the grant's targets were checked");
  assert.ok(
    report.drift.some((d) =>
      d.kind === "missing-grant" && d.grantee === BOB && d.resource === BUILDING
    ),
    "the un-projected building grant is reported as missing",
  );
});

Deno.test("query('ExportArchive', {}, …) dispatches to the read core and returns the archive value", async () => {
  const { session } = readPod();

  const result = await query("ExportArchive", {}, session);

  // A non-paramless read: the param→value path is exercised, the value returned.
  assert.equal(result.count, 1, "the one in-collection resource was archived");
  assert.ok(result.bytes.length > 0, "archive bytes returned");
});

Deno.test("invokeByName throws IntentNotInvocableError for a name with no extracted core", () => {
  const { session } = sharePod();
  // Step 5 extracted the WHOLE catalog, so no real catalog name lacks a core; a
  // name that isn't a catalog write intent at all still hits the clear-error path
  // (never a silent fallback).
  assert.throws(
    () => invokeByName("NotARealIntent", {}, session),
    (err: unknown) =>
      err instanceof IntentNotInvocableError && err.name === "IntentNotInvocableError" &&
      (err as IntentNotInvocableError).kind === "write",
    "a name without an extracted core is a clear error, never a silent fallback",
  );
});

// ── CQS pinned at the TYPE level (deno test typechecks these) ─────────────────
// These must NOT compile: passing a read name to invoke(), or a write name to
// query(), is a compile error — the two separate maps/functions enforce CQS
// without any runtime `effect` switch.
Deno.test("CQS type proofs", () => {
  const { session } = sharePod();
  // @ts-expect-error AuditGrants is a READ intent — not invocable as a write.
  void (() => invoke("AuditGrants", {}, session));
  // @ts-expect-error ShareBuilding is a WRITE intent — not queryable as a read.
  void (() => query("ShareBuilding", {
    buildingUri: "x",
    recipients: [],
    includeEnergyData: false,
  }, session));
});
