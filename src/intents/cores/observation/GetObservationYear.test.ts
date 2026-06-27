/// <reference lib="deno.ns" />
// Tier-1: GetObservationYear resolves the building (offline fixture) then picks the
// requested year from its datasets (injected here, so no dataset Turtle needed).
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";
import { CONSUMPTION_NS, REC_BUILDING } from "../../../services/rdf/vocabularies.ts";
import type { EnergyDataset } from "../../../services/energy/energyDataset.ts";
import { getObservationYearCore } from "./GetObservationYear.ts";

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

// Two annual datasets to pick between (injected — bypasses dataset Turtle/parse).
const DATASETS = [
  { year: 2023, metrics: { electricityConsumption: 800 } },
  { year: 2024, metrics: { electricityConsumption: 1000 } },
] as unknown as EnergyDataset[];

Deno.test("getObservationYearCore: returns the requested year's metrics", async () => {
  const obs = await getObservationYearCore(
    fakePod(),
    { building: `${BUILDING}#it`, year: 2024 },
    () => Promise.resolve(DATASETS),
  );
  assert.ok(obs);
  assert.equal(obs!.year, 2024);
  assert.deepEqual(obs!.metrics, { electricityConsumption: 1000 });
});

Deno.test("getObservationYearCore: a year with no dataset → null", async () => {
  const obs = await getObservationYearCore(
    fakePod(),
    { building: `${BUILDING}#it`, year: 2099 },
    () => Promise.resolve(DATASETS),
  );
  assert.equal(obs, null);
});
