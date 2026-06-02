/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  fetchAndParseData,
  SessionExpiredError,
} from "./TurtleParsingService.ts";
import { _setStorageRootForTesting } from "./utils/solidUtils.ts";

// Offline fixtures for a single Pod. The fake Session below serves these by URL
// so fetchAndParseData runs end-to-end with no network. WebID resolves to:
//   storageRoot  = https://pod.example/
//   podBaseUrl   = https://pod.example/profile/
//   registry     = https://pod.example/granergize/dataSources.ttl
const WEBID = "https://pod.example/profile/card#me";
// Storage root is normally resolved from pim:storage at login; prime it here since
// these tests call fetchAndParseData directly (no login/resolveStorageRoot step).
_setStorageRootForTesting(WEBID, "https://pod.example/");
const REGISTRY_URL = "https://pod.example/granergize/dataSources.ttl";
const HIDDEN_URL = "https://pod.example/granergize/hiddenBuildings.ttl";
const BUILDINGS_URL = "https://pod.example/buildings.ttl";
const AGENTS_URL = "https://pod.example/agents.ttl";
const ENERGY_B1_URL = "https://pod.example/energy/b1.ttl";
const ENERGY_B2_URL = "https://pod.example/energy/b2.ttl";

const GRAN = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";

const FIXTURES: Record<string, string> = {
  [REGISTRY_URL]: `
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix gran: <${GRAN}> .
<${REGISTRY_URL}> a gran:DataSourceRegistry ;
  dcterms:creator <${WEBID}> ;
  gran:hasBuildingDataSource <${BUILDINGS_URL}> ;
  gran:hasAgentDataSource <${AGENTS_URL}> .
<${BUILDINGS_URL}> gran:dataSourceRole gran:DummyRole .
`,
  // Present but empty: no hidden buildings.
  [HIDDEN_URL]: "",
  [BUILDINGS_URL]: `
@prefix gran: <${GRAN}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#building-1> a rec:Building ;
  geo:lat 49.0 ;
  geo:long 11.0 ;
  gran:hasEnergyMeasurementData [
    gran:measurementYear "2023" ;
    gran:datasetLocation "${ENERGY_B1_URL}" ;
    gran:type "electricity"
  ] .
<#building-2> a rec:Building ;
  geo:lat 49.5 ;
  geo:long 11.5 ;
  gran:hasEnergyMeasurementData [
    gran:measurementYear "2023" ;
    gran:datasetLocation "${ENERGY_B2_URL}" ;
    gran:type "electricity"
  ] .
`,
  [AGENTS_URL]: `
@prefix schema: <https://schema.org/> .
<#agent1> schema:name "ACME Energy" .
`,
  [ENERGY_B1_URL]: `
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix gran: <${GRAN}> .
<#obs1> a sosa:Observation ;
  sosa:observedProperty gran:Electricity ;
  sosa:hasResult [ sosa:hasSimpleResult 1000 ] .
`,
  [ENERGY_B2_URL]: `
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix gran: <${GRAN}> .
<#obs1> a sosa:Observation ;
  sosa:observedProperty gran:Electricity ;
  sosa:hasResult [ sosa:hasSimpleResult 2000 ] .
`,
};

interface FetchLog {
  energyInFlight: number;
  maxEnergyInFlight: number;
  energyResolved: number;
}

function makeSession(
  opts: { log: FetchLog; fixtures?: Record<string, string>; delayMs?: number },
): Session {
  const { log, fixtures = FIXTURES, delayMs = 20 } = opts;
  const fetch = async (input: string | URL): Promise<Response> => {
    const raw = typeof input === "string" ? input : input.toString();
    const url = raw.split("?")[0]; // drop the registry's ?t=<timestamp> cache-buster
    const isEnergy = url.startsWith("https://pod.example/energy/");
    if (isEnergy) {
      log.energyInFlight++;
      log.maxEnergyInFlight = Math.max(log.maxEnergyInFlight, log.energyInFlight);
      // Hold the connection open so overlapping (concurrent) fetches are visible.
      await new Promise((r) => setTimeout(r, delayMs));
      log.energyInFlight--;
      log.energyResolved++;
    }
    const body = fixtures[url];
    if (body === undefined) {
      return new Response("Not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/turtle" },
    });
  };
  return {
    info: { webId: WEBID, isLoggedIn: true },
    fetch,
  } as unknown as Session;
}

function newLog(): FetchLog {
  return { energyInFlight: 0, maxEnergyInFlight: 0, energyResolved: 0 };
}

Deno.test("fetchAndParseData parses buildings, agents and energy end-to-end", async () => {
  const result = await fetchAndParseData(makeSession({ log: newLog() }));

  assert.equal(result.buildings.length, 2);
  const b1 = result.buildings.find((b) => b.id === 1);
  assert.ok(b1, "building 1 present");
  assert.equal(b1!.lat, 49.0);
  assert.equal(b1!.long, 11.0);
  assert.equal(b1!.sourceRole, "dummy");
  assert.equal(b1!.isShared, false);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].name, "ACME Energy");

  const e1 = result.energyNeed.find((e) => e.id === 1);
  const e2 = result.energyNeed.find((e) => e.id === 2);
  assert.equal(e1?.energyNeed.electricity, 1000);
  assert.equal(e2?.energyNeed.electricity, 2000);

  // Average across both buildings.
  assert.equal(result.averages.electricity, 1500);
});

Deno.test("fetchAndParseData fetches energy files concurrently, not serially", async () => {
  const log = newLog();
  await fetchAndParseData(makeSession({ log }));

  assert.equal(log.energyResolved, 2);
  // Serial loading would peak at 1 in-flight energy fetch; concurrent peaks at 2.
  assert.equal(log.maxEnergyInFlight, 2);
});

Deno.test("fetchAndParseData reports buildings/agents before energy resolves", async () => {
  const log = newLog();
  let phase1Fired = false;
  let phase1Buildings = -1;
  let phase1Agents = -1;
  let energyResolvedAtPhase1 = -1;

  await fetchAndParseData(makeSession({ log }), (partial) => {
    phase1Fired = true;
    phase1Buildings = partial.buildings.length;
    phase1Agents = partial.agents.length;
    energyResolvedAtPhase1 = log.energyResolved;
  });

  assert.ok(phase1Fired, "phase-1 callback fired");
  assert.equal(phase1Buildings, 2);
  assert.equal(phase1Agents, 1);
  // The whole point of the two-phase load: buildings/agents are handed over
  // before any energy file has finished loading.
  assert.equal(energyResolvedAtPhase1, 0);
});

Deno.test("fetchAndParseData tolerates an inaccessible energy source", async () => {
  // Drop building 2's energy file — the rest of the load must still succeed.
  const fixtures = { ...FIXTURES };
  delete fixtures[ENERGY_B2_URL];

  const result = await fetchAndParseData(
    makeSession({ log: newLog(), fixtures }),
  );

  assert.equal(result.buildings.length, 2);
  const e1 = result.energyNeed.find((e) => e.id === 1);
  const e2 = result.energyNeed.find((e) => e.id === 2);
  assert.equal(e1?.energyNeed.electricity, 1000);
  assert.equal(e2, undefined);
  assert.equal(result.averages.electricity, 1000);
});

Deno.test("fetchAndParseData throws SessionExpiredError when sources return 401", async () => {
  // Token expired: the building source 401s. fetchAndParseData must signal this
  // distinctly so the caller keeps prior data instead of blanking the map.
  const fetch = (input: string | URL): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    if (url === BUILDINGS_URL) {
      return Promise.resolve(
        new Response(null, { status: 401, statusText: "Unauthorized" }),
      );
    }
    const body = FIXTURES[url];
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
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch,
  } as unknown as Session;

  await assert.rejects(
    () => fetchAndParseData(session),
    SessionExpiredError,
  );
});
