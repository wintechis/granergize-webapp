/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
//
// Tier-1 proof that the SaveObservation core swallows a failed grant
// reconciliation: the energy year is the commit, so a reconcile that throws must
// NOT fail the save — the core still resolves `Settled`. Driven headless with a
// fake offline-fixture Session.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { saveObservationCore } from "./SaveObservation.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";
import type { EnergyDataset } from "../../../services/rdf/energyDataset.ts";

const OWNER = "https://a.example/profile/card#me";
const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const SUBJECT = `${BUILDING}#b-1`;
const SHARED_OUT = "https://a.example/granergize/shared-out/";

const BUILDING_TTL = `
@prefix rec: <https://w3id.org/rec#> .
<${SUBJECT}> a rec:Building .
`;

const DATASET: EnergyDataset = {
  year: 2024,
  granularity: "P1Y",
  scenario: "actual",
  metrics: { electricityConsumption: 1234 },
} as unknown as EnergyDataset;

/**
 * Fake Pod where every energy write succeeds, but ANY read/fold of the
 * `shared-out/` log throws — so `reconcileBuildingGrants` (called inside the
 * core after the save) rejects. Records calls so we can assert the year was
 * actually written before the reconcile blew up.
 */
function pod(): { session: PodGateway; calls: string[] } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = { [BUILDING]: BUILDING_TTL };
  const calls: string[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    // The reconcile step folds shared-out/ — make that path explode.
    if (url.startsWith(SHARED_OUT)) {
      return Promise.reject(new Error("boom: shared-out unreachable"));
    }
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

Deno.test("saveObservationCore (headless): a failed reconcile is swallowed — the save still resolves Settled", async () => {
  const { session, calls } = pod();

  // The reconcile inside the core rejects, yet the core must resolve, not throw.
  const outcome = await saveObservationCore(session, {
    fileUri: BUILDING,
    subjectUri: SUBJECT,
    dataset: DATASET,
  });

  assert.deepEqual(outcome, { ok: true }, "save resolves Settled despite reconcile failure");

  // Prove the year really was written (a PUT to the building file relinking the
  // dataset) — the swallow didn't mask a no-op.
  assert.ok(
    calls.some((c) => c.startsWith("PUT ") && c.includes("/buildings/b-1.ttl")),
    "building file was rewritten to link the new dataset",
  );
  // Prove the reconcile path was actually exercised (the shared-out fold ran and threw).
  assert.ok(
    calls.some((c) => c.includes(SHARED_OUT)),
    "reconcile attempted to fold the shared-out log",
  );
});
