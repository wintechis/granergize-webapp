/// <reference lib="deno.ns" />
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { getEnergyDataUrls, shareBuildingData } from "./share.ts";
import { CONSUMPTION_NS } from "../rdf/vocabularies.ts";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";

const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const ENERGY = `${BUILDING.replace(/\.ttl$/, "")}/energy`;

/** A building file linking four energy datasets across two years/scenarios. */
const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${ENERGY}/2024-P1Y.ttl#ds> ,
                        <${ENERGY}/2024-PT15M.ttl#ds> ,
                        <${ENERGY}/2024-P1Y-planned.ttl#ds> ,
                        <${ENERGY}/2023-P1Y.ttl#ds> .
`;

/** Fake session serving the building Turtle by URL (query stripped). */
function session(): Session {
  return {
    info: { isLoggedIn: true, webId: "https://a.example/profile/card#me" },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (url === BUILDING) {
        return Promise.resolve(
          new Response(BUILDING_TTL, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;
}

Deno.test("getEnergyDataUrls: no years filter grants every dataset (+ series container)", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session());
  const set = new Set(urls.map((t) => t.url));

  // All four dataset files are granted.
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-P1Y-planned.ttl`));
  assert.ok(set.has(`${ENERGY}/2023-P1Y.ttl`));

  // The PT15M series also grants its daily-files container (acl:default).
  const container = urls.find((t) => t.url === `${ENERGY}/2024-PT15M/`);
  assert.ok(container, "series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 5);
});

Deno.test("getEnergyDataUrls: years:[2024] excludes 2023, keeps the 2024 series container", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session(), [2024]);
  const set = new Set(urls.map((t) => t.url));

  // 2023 is excluded.
  assert.ok(!set.has(`${ENERGY}/2023-P1Y.ttl`));

  // Both 2024 scenarios (actual + planned) and the series are kept...
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-P1Y-planned.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M.ttl`));
  // ...including the 2024 series container.
  const container = urls.find((t) => t.url === `${ENERGY}/2024-PT15M/`);
  assert.ok(container, "2024 series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 4);
});

Deno.test("getEnergyDataUrls: an unmatched year grants no energy", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session(), [1999]);
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
  session: Session;
  calls: { url: string; method: string; body?: string }[];
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
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
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
    session: { info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session,
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
    c.method === "POST" && c.url === SHARED_OUT
  );
  const firstAcl = calls.findIndex((c) =>
    c.method === "PUT" && c.url.endsWith(".acl")
  );
  const inboxPost = calls.findIndex((c) =>
    c.method === "POST" && c.url === BOB_INBOX
  );
  assert.ok(logAppend !== -1, "shared-out/ event appended");
  assert.ok(firstAcl !== -1, "an .acl was written");
  assert.ok(inboxPost !== -1, "recipient inbox notified");
  assert.ok(logAppend < firstAcl, "log append precedes ACL enforcement");
  assert.ok(firstAcl < inboxPost, "enforcement precedes the inbox notify");
});

Deno.test("the inbox grant event carries the per-year scope (every share dimension)", async () => {
  const { session: s, calls } = sharePod();
  await shareBuildingData(BUILDING, RECIPIENT, s, {
    includeEnergyData: true,
    years: [2024],
  });
  const inbox = calls.find((c) => c.method === "POST" && c.url === BOB_INBOX);
  assert.ok(inbox?.body?.includes("includesEnergyYear"), "years triple present");
  assert.ok(inbox?.body?.includes('"2024"'), "the granted year is recorded");
});
