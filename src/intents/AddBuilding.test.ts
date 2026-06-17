import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
/// <reference lib="deno.ns" />
//
// Tier-1 proof that the AddBuilding core is callable HEADLESS, driven with a fake
// offline-fixture Session. Asserts the boundary case the plan pins: a user abort
// is an OUTCOME (`aborted: true` + the buildings already written), not an error.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { addBuildingCore } from "./AddBuilding.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";

interface Call {
  url: string;
  method: string;
}

/**
 * A fake one-Pod world: PUT/POST succeed, GET/HEAD answer from the store.
 * `onCall` (optional) fires for every request — used to abort mid-batch.
 */
function ownerPod(
  onCall?: (c: Call) => void,
): { session: PodGateway; calls: Call[] } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {};
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    onCall?.({ url, method });
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

Deno.test("addBuildingCore (headless): two buildings → both added, not aborted", async () => {
  const { session } = ownerPod();

  const outcome = await addBuildingCore(session, {
    buildings: [{ label: "Lager A" }, { label: "Lager B" }],
  });

  assert.equal(outcome.aborted, false);
  assert.equal(outcome.added.length, 2, "both subject IRIs returned");
  for (const uri of outcome.added) {
    assert.ok(uri.startsWith("https://a.example/"), `subject IRI under owner storage: ${uri}`);
  }
});

Deno.test("addBuildingCore (headless): a pre-aborted signal → aborted outcome, nothing written", async () => {
  const { session } = ownerPod();
  const controller = new AbortController();
  controller.abort();

  const outcome = await addBuildingCore(session, {
    buildings: [{ label: "Lager A" }],
    signal: controller.signal,
  });

  // A cancel is an OUTCOME, not a thrown error — the exact shape the adapter reads.
  assert.deepEqual(outcome, { added: [], aborted: true });
});

Deno.test("addBuildingCore (headless): abort partway → tallies the buildings already written", async () => {
  const controller = new AbortController();
  // Abort once the FIRST building's file (the commit-point PUT under buildings/)
  // lands, so the loop throws on the SECOND building's top-of-loop
  // `throwIfAborted()`. The first building is already committed → in `added`.
  let buildingFiles = 0;
  const { session } = ownerPod((c) => {
    if (c.method === "PUT" && /\/buildings\/[^/]+\.ttl$/.test(c.url)) {
      buildingFiles++;
      if (buildingFiles === 1) controller.abort();
    }
  });

  const outcome = await addBuildingCore(session, {
    buildings: [{ label: "Lager A" }, { label: "Lager B" }],
    signal: controller.signal,
  });

  assert.equal(outcome.aborted, true, "a partway cancel is an aborted outcome");
  assert.equal(outcome.added.length, 1, "the building written before the abort is tallied");
});
