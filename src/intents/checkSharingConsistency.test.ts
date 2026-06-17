import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
/// <reference lib="deno.ns" />
//
// Tier-1 proof that the CheckSharingConsistency read core is callable HEADLESS:
// it is driven directly with a fake offline-fixture Session — no React, no
// renderHook — and asserted to RETURN its value (the log↔ACL drift report).
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { checkSharingConsistencyCore } from "./checkSharingConsistency.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { CONSUMPTION_NS, GRAN_NS, REC_BUILDING } from "../services/rdf/vocabularies.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);

const BOB = "https://bob.example/profile/card#me";
const SHARED_OUT = `${ROOT}granergize/shared-out/`;
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;

// A building with no energy datasets → the only grant target is the file itself.
const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1> a <${REC_BUILDING}> .
`;

/** One shared-out grant event resource (subject `<>`). */
function grantTtl(grantee: string, resource: string, at: string): string {
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
   gran:kind <${REC_BUILDING}> ;
   prov:generatedAtTime "${at}"^^xsd:dateTime .
`;
}

/**
 * A WAC .acl granting `grantee` acl:Read on `resource` (matching what the
 * projection writes). `isContainer` adds the `acl:default` the audit requires
 * for a container target (the building's `files/`).
 */
function aclTtl(resource: string, grantee: string, isContainer = false): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<${resource}.acl#Read_x> a acl:Authorization ;
   acl:agent <${grantee}> ;
   acl:accessTo <${resource}> ;
${isContainer ? `   acl:default <${resource}> ;\n` : ""}   acl:mode acl:Read .
`;
}

/** A building with no energy datasets grants two targets: the file + its files/ container. */
const FILES_CONTAINER = `${BUILDING.replace(/\.ttl$/, "")}/files/`;

function makePod(opts: { withAcl: boolean }): { session: PodGateway } {
  const ev1 = `${SHARED_OUT}e1`;
  const store: Record<string, string> = {
    [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${SHARED_OUT}> ldp:contains <${ev1}> .`,
    [ev1]: grantTtl(BOB, BUILDING, "2026-06-04T10:00:00Z"),
    [BUILDING]: BUILDING_TTL,
  };
  if (opts.withAcl) {
    store[`${BUILDING}.acl`] = aclTtl(BUILDING, BOB);
    store[`${FILES_CONTAINER}.acl`] = aclTtl(FILES_CONTAINER, BOB, true);
  }

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
  return { session: sessionGateway({ info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session) };
}

Deno.test("checkSharingConsistencyCore (headless): a logged grant with no .acl → missing-grant drift", async () => {
  const { session } = makePod({ withAcl: false });

  const report = await checkSharingConsistencyCore(session);

  // The read RETURNS its value (the drift report) — proven without any React.
  // A bare building grants two targets (the file + its files/ container); with
  // no .acl projected at all, the building file is reported as missing.
  assert.ok(report.checked >= 1, "the grant's targets were checked");
  assert.equal(report.skipped, 0);
  assert.equal(report.missing, 0);
  assert.ok(
    report.drift.some((d) =>
      d.kind === "missing-grant" && d.grantee === BOB && d.resource === BUILDING
    ),
    "the un-projected building grant is reported as missing",
  );
});

Deno.test("checkSharingConsistencyCore (headless): a logged grant with a matching .acl → no drift", async () => {
  const { session } = makePod({ withAcl: true });

  const report = await checkSharingConsistencyCore(session);

  assert.ok(report.checked >= 1, "the grant's targets were checked");
  assert.equal(report.drift.length, 0, "ACL matches the folded log — clean");
});
