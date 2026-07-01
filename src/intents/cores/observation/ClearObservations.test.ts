/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
//
// Tier-1 proof that the ClearObservations core REPORTS per-dataset failures in
// its tally instead of swallowing them. The finder's old inline loop did
// `.catch(() => {})` per dataset and toasted success unconditionally — a
// half-failed destructive bulk delete looked like a success. The core's Tally
// outcome is the seam that makes the partial failure observable.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { clearObservationsCore, type ClearObservationsParams } from "./ClearObservations.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";
import { CONSUMPTION_NS } from "../../../services/rdf/vocabularies.ts";

const OWNER = "https://a.example/profile/card#me";
const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const SUBJECT = `${BUILDING}#b-1`;
const OBS = "https://a.example/granergize/observations";
const DS_2024 = `${OBS}/2024/d1.ttl`;
const DS_2023 = `${OBS}/2023/d2.ttl`;

const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${SUBJECT}>
  cons:hasEnergyDataset <${DS_2024}#ds> ,
                        <${DS_2023}#ds> .
<${DS_2024}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
<${DS_2023}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

/** Fake Pod serving the building + datasets; DELETE of the URIs in `failing` 500s. */
function pod(failing: string[] = []): { session: PodGateway; deleted: string[] } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {
    [BUILDING]: BUILDING_TTL,
    [DS_2024]: "# dataset",
    [DS_2023]: "# dataset",
  };
  const deleted: string[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "DELETE") {
      if (failing.includes(url)) {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      deleted.push(url);
      delete store[url];
      return Promise.resolve(new Response(null, { status: 205 }));
    }
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
    session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session),
    deleted,
  };
}

const DATASETS: ClearObservationsParams["datasets"] = [
  { year: 2024, granularity: "P1Y", scenario: "actual" },
  { year: 2023, granularity: "P1Y", scenario: "actual" },
];

Deno.test("clearObservationsCore: all datasets deleted → a full tally", async () => {
  const { session, deleted } = pod();
  const outcome = await clearObservationsCore(session, {
    fileUri: BUILDING,
    subjectUri: SUBJECT,
    datasets: DATASETS,
  });
  assert.deepEqual(outcome, { done: 2, total: 2 });
  assert.ok(deleted.includes(DS_2024) && deleted.includes(DS_2023));
});

Deno.test("clearObservationsCore: a failed per-dataset delete is REPORTED in the tally, not swallowed", async () => {
  // 2023's file DELETE 500s; the loop must go on (best-effort per item, like
  // every other bulk core) and the outcome must say 1 of 2 — the honest signal
  // the finder turns into a partial-failure toast instead of a success one.
  const { session, deleted } = pod([DS_2023]);
  const outcome = await clearObservationsCore(session, {
    fileUri: BUILDING,
    subjectUri: SUBJECT,
    datasets: DATASETS,
  });
  assert.deepEqual(outcome, { done: 1, total: 2 }, "partial failure is visible in the outcome");
  assert.ok(deleted.includes(DS_2024), "the healthy dataset was still deleted");
});
