/// <reference lib="deno.ns" />
// Tier-1: FindNearbyInstallations resolves the building (offline fixture) for its
// coordinates, then queries the wrapper through an injected fetch (no live MaStR).
// Off-Pod, read-only.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { GEO_NS, REC_BUILDING } from "../services/rdf/vocabularies.ts";
import type { NearbyInstallation } from "../services/mastrNearby.ts";
import { findNearbyInstallationsCore } from "./FindNearbyInstallations.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
// Coordinates live on the geo:Point blank node (geo:location), the only place the
// parser reads them.
const TTL = `
@prefix geo: <${GEO_NS}> .
<${BUILDING}#it> a <${REC_BUILDING}> ;
  geo:location [ a geo:Point ; geo:lat "49.45" ; geo:long "11.08" ] .
`;

function fakePod(): PodGateway {
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    if (url === BUILDING) {
      return Promise.resolve(
        new Response(TTL, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return sessionGateway(
    { info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session,
  );
}

const INSTALLATIONS = [
  { iri: "x:1", label: "PV 1", kind: "solar", lat: 49.46, long: 11.09, ags: "09564000", distanceKm: 1.2 },
  { iri: "x:2", label: "Wind 1", kind: "wind", lat: 49.44, long: 11.07, ags: "09564000", distanceKm: 2.1 },
] as NearbyInstallation[];

Deno.test("findNearbyInstallationsCore: resolves the building's coords + returns the wrapper hits", async () => {
  let calledWith: { lat: number; long: number } | null = null;
  const out = await findNearbyInstallationsCore(
    fakePod(),
    { building: `${BUILDING}#it` },
    (lat, long) => {
      calledWith = { lat, long };
      return Promise.resolve(INSTALLATIONS);
    },
  );
  assert.deepEqual(calledWith, { lat: 49.45, long: 11.08 });
  assert.deepEqual(out.map((i) => i.iri), ["x:1", "x:2"]);
});

Deno.test("findNearbyInstallationsCore: kind narrows the carrier", async () => {
  const out = await findNearbyInstallationsCore(
    fakePod(),
    { building: `${BUILDING}#it`, kind: "solar" },
    () => Promise.resolve(INSTALLATIONS),
  );
  assert.deepEqual(out.map((i) => i.iri), ["x:1"]);
});

Deno.test("findNearbyInstallationsCore: an unresolvable building → []", async () => {
  const out = await findNearbyInstallationsCore(
    fakePod(),
    { building: `${ROOT}granergize/buildings/missing.ttl#it` },
    () => Promise.resolve(INSTALLATIONS),
  );
  assert.deepEqual(out, []);
});
