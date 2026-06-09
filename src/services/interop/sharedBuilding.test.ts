/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { loadSharedBuilding } from "./sharedBuilding.ts";
import { GRAN_NS } from "../rdf/vocabularies.ts";

const FILE = "https://alice.example/granergize/buildings/b1.ttl";

/** A minimal shared building file (no PROV attribution). */
const BUILDING_TTL = `@prefix rec: <https://w3id.org/rec#> .
@prefix gran: <${GRAN_NS}> .
<${FILE}#b1> a rec:Building ;
  gran:hasEnergyDataset <${FILE.replace(/\.ttl$/, "")}/energy/2024-P1Y.ttl#ds> .
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

Deno.test("loadSharedBuilding throws on a non-ok response", async () => {
  await assert.rejects(
    () => loadSharedBuilding({ buildingUri: FILE }, session("nope", 403)),
    /HTTP 403/,
  );
});
