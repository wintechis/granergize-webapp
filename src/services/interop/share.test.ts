/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../pod/podGateway.ts";
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  applyBuildingGrant,
  getEnergyDataUris,
  shareBuildingData,
} from "./share.ts";
import { CONSUMPTION_NS } from "../rdf/vocabularies.ts";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";

const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const OBS = "https://a.example/granergize/observations";

// Time-first dataset descriptor IRIs (fixed stems for the test).
const DS_2024_P1Y = `${OBS}/2024/d1.ttl`;
const DS_2024_PT15M = `${OBS}/2024/d2.ttl`;
const DS_2024_PLANNED = `${OBS}/2024/d3.ttl`;
const DS_2023_P1Y = `${OBS}/2023/d4.ttl`;
const YEAR_2024 = `${OBS}/2024/`;

/** A building file linking four energy datasets across two years/scenarios. */
const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${DS_2024_P1Y}#ds> ,
                        <${DS_2024_PT15M}#ds> ,
                        <${DS_2024_PLANNED}#ds> ,
                        <${DS_2023_P1Y}#ds> .
<${DS_2024_P1Y}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
<${DS_2024_PT15M}#ds> cons:granularity "PT15M" ; cons:scenario cons:Actual .
<${DS_2024_PLANNED}#ds> cons:granularity "P1Y" ; cons:scenario cons:Planned .
<${DS_2023_P1Y}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

/** Fake session serving the building Turtle by URL (query stripped). */
function session(): PodGateway {
  return sessionGateway({
    info: { isLoggedIn: true, webId: "https://a.example/profile/card#me" },
    fetch: (input: string | URL | Request) => {
      const uri = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (uri === BUILDING) {
        return Promise.resolve(
          new Response(BUILDING_TTL, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session);
}

Deno.test("getEnergyDataUris: no years filter grants every dataset (+ series container)", async () => {
  const urls = await getEnergyDataUris(BUILDING, session());
  const set = new Set(urls.map((t) => t.uri));

  // All four dataset files are granted.
  assert.ok(set.has(DS_2024_P1Y));
  assert.ok(set.has(DS_2024_PT15M));
  assert.ok(set.has(DS_2024_PLANNED));
  assert.ok(set.has(DS_2023_P1Y));

  // The PT15M series also grants its day-chunks' year container (acl:default).
  const container = urls.find((t) => t.uri === YEAR_2024);
  assert.ok(container, "series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 5);
});

Deno.test("getEnergyDataUris: years:[2024] excludes 2023, keeps the 2024 series container", async () => {
  const urls = await getEnergyDataUris(BUILDING, session(), [2024]);
  const set = new Set(urls.map((t) => t.uri));

  // 2023 is excluded.
  assert.ok(!set.has(DS_2023_P1Y));

  // Both 2024 scenarios (actual + planned) and the series are kept...
  assert.ok(set.has(DS_2024_P1Y));
  assert.ok(set.has(DS_2024_PLANNED));
  assert.ok(set.has(DS_2024_PT15M));
  // ...including the 2024 series container.
  const container = urls.find((t) => t.uri === YEAR_2024);
  assert.ok(container, "2024 series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 4);
});

Deno.test("getEnergyDataUris: an unmatched year grants no energy", async () => {
  const urls = await getEnergyDataUris(BUILDING, session(), [1999]);
  assert.strictEqual(urls.length, 0);
});

// ── shareBuildingData ordering + inbox payload ─────────────────────────────────

const OWNER = "https://a.example/profile/card#me";
const RECIPIENT = "https://bob.example/profile/card#me";
const SHARED_OUT = "https://a.example/granergize/shared-out/";
const BOB_INBOX = "https://bob.example/granergize/inbox/";

/**
 * Stateful fake two-Pod world for a full shareBuildingData run: the owner's
 * building + shared-out/ live on a.example, the recipient's inbox on
 * bob.example (discovered via the convention path — the app-root GET 404s).
 * Records every call in order so ordering can be asserted.
 */
function sharePod(): {
  session: PodGateway;
  calls: { uri: string; method: string; body?: string }[];
} {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {
    [BUILDING]: BUILDING_TTL,
    // The recipient's profile: inbox discovery resolves Bob's storage root from
    // pim:storage (resolveStorageRootForWebId is uncached, always a fetch).
    ["https://bob.example/profile/card"]:
      `@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${RECIPIENT}> pim:storage <https://bob.example/> .`,
  };
  const calls: { uri: string; method: string; body?: string }[] = [];
  const fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const uri = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ uri, method, body: init?.body ? String(init.body) : undefined });
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[uri] = String(init.body);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "HEAD") {
      return Promise.resolve(
        new Response("", { status: uri.endsWith("/") || uri in store ? 200 : 404 }),
      );
    }
    const body = store[uri];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      }),
    );
  };
  return {
    session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session),
    calls,
  };
}

Deno.test("shareBuildingData orders log append BEFORE ACL writes BEFORE the inbox post", async () => {
  // The shared-out/ log is ground truth: a failure mid-share must leave an
  // event-without-ACL (repairable by reissueGrants), never an ACL-without-event
  // (live access the log doesn't know about).
  const { session: s, calls } = sharePod();
  await shareBuildingData(BUILDING, RECIPIENT, s, {
    includeEnergyData: true,
    years: [2024],
  });

  const logAppend = calls.findIndex((c) =>
    c.method === "POST" && c.uri === SHARED_OUT
  );
  const firstAcl = calls.findIndex((c) =>
    c.method === "PUT" && c.uri.endsWith(".acl")
  );
  const inboxPost = calls.findIndex((c) =>
    c.method === "POST" && c.uri === BOB_INBOX
  );
  assert.ok(logAppend !== -1, "shared-out/ event appended");
  assert.ok(firstAcl !== -1, "an .acl was written");
  assert.ok(inboxPost !== -1, "recipient inbox notified");
  assert.ok(logAppend < firstAcl, "log append precedes ACL enforcement");
  assert.ok(firstAcl < inboxPost, "enforcement precedes the inbox notify");
});

Deno.test("applyBuildingGrant: a failed energy-dataset grant still rejects (pooled fan-out propagates)", async () => {
  // The energy grants run through a bounded pool; the contract that a failed
  // grant must SURFACE to the caller (so the share errors and the user sees it)
  // is unchanged — pin it. One dataset's .acl PUT 500s; applyBuildingGrant
  // must reject, even though the other (independent) grants may succeed.
  const { session: s } = sharePod();
  const FAIL_ACL = `${DS_2023_P1Y}.acl`;
  const inner = s.fetch;
  const failing: PodGateway = {
    webId: s.webId,
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const uri = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (uri === FAIL_ACL && (init?.method ?? "GET").toUpperCase() === "PUT") {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      return inner(input, init);
    },
  };

  await assert.rejects(
    () => applyBuildingGrant(BUILDING, RECIPIENT, failing),
    /Failed to update ACL/,
  );
});

Deno.test("the inbox grant event carries the per-year scope (every share dimension)", async () => {
  const { session: s, calls } = sharePod();
  await shareBuildingData(BUILDING, RECIPIENT, s, {
    includeEnergyData: true,
    years: [2024],
  });
  const inbox = calls.find((c) => c.method === "POST" && c.uri === BOB_INBOX);
  assert.ok(inbox?.body?.includes("includesEnergyYear"), "years triple present");
  assert.ok(inbox?.body?.includes('"2024"'), "the granted year is recorded");
});
