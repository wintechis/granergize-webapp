/// <reference lib="deno.ns" />
// Tier-1: GetBuilding resolves a building IRI to its typed instance (via the
// EntityQuery resolver), over an offline fixture.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";
import { CONSUMPTION_NS, REC_BUILDING } from "../../../services/rdf/vocabularies.ts";
import { getBuildingCore } from "./GetBuilding.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
const TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#it> a <${REC_BUILDING}> ;
  cons:hasEnergyDataset <${ROOT}granergize/observations/2024/d1.ttl#ds> .
<${ROOT}granergize/observations/2024/d1.ttl#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

function fakePod(): PodGateway {
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    if (url === BUILDING) {
      return Promise.resolve(new Response(TTL, { status: 200, headers: { "Content-Type": "text/turtle" } }));
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return sessionGateway({ info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session);
}

Deno.test("getBuildingCore: resolves an own building IRI to its instance", async () => {
  const b = await getBuildingCore(fakePod(), { id: `${BUILDING}#it` });
  assert.ok(b, "expected a building");
  assert.equal(b!.uri, `${BUILDING}#it`);
  assert.equal(b!.isShared, false); // lives under the viewer's storage root
});

Deno.test("getBuildingCore: an unresolvable IRI → undefined", async () => {
  const b = await getBuildingCore(fakePod(), { id: "https://x.example/nope.ttl#it" });
  assert.equal(b, undefined);
});
