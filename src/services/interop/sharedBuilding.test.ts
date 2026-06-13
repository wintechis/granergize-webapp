/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { loadSharedBuilding } from "./sharedBuilding.ts";
import { CONSUMPTION_NS } from "../rdf/vocabularies.ts";

const FILE = "https://alice.example/granergize/buildings/b1.ttl";

/** A minimal shared building file (no PROV attribution). */
const BUILDING_TTL = `@prefix rec: <https://w3id.org/rec#> .
@prefix cons: <${CONSUMPTION_NS}> .
<${FILE}#b1> a rec:Building ;
  cons:hasEnergyDataset <${FILE.replace(/\.ttl$/, "")}/energy/2024-P1Y.ttl#ds> .
`;

/** Fake session serving the building Turtle at FILE; 404 elsewhere. */
function session(body = BUILDING_TTL, status = 200): Session {
  return {
    info: { isLoggedIn: true, webId: "https://me.example/profile/card#me" },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      return Promise.resolve(
        url === FILE
          ? new Response(body, {
            status,
            headers: { "Content-Type": "text/turtle" },
          })
          : new Response("Not found", { status: 404 }),
      );
    },
  } as unknown as Session;
}

Deno.test("loadSharedBuilding fetches + parses the shared building file", async () => {
  const b = await loadSharedBuilding({ buildingUri: FILE }, session());
  assert.ok(b, "a building was parsed");
  assert.equal((b!.energyDatasets ?? []).length, 1);
});

Deno.test("loadSharedBuilding: a revoked/deleted share is 'gone' (null), not an error", async () => {
  // The owner revoking your access (403) or deleting the building (404) is a
  // normal lifecycle event for a building shared WITH you — null, not a throw,
  // so it doesn't raise a global error notification.
  assert.equal(
    await loadSharedBuilding({ buildingUri: FILE }, session("forbidden", 403)),
    null,
  );
  assert.equal(
    await loadSharedBuilding({ buildingUri: FILE }, session("gone", 404)),
    null,
  );
});

Deno.test("loadSharedBuilding throws on a genuine failure (e.g. HTTP 500)", async () => {
  await assert.rejects(
    () => loadSharedBuilding({ buildingUri: FILE }, session("boom", 500)),
    /HTTP 500/,
  );
});
