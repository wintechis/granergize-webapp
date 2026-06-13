/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  fetchAndParseData,
  loadBuildings,
  SessionExpiredError,
} from "./TurtleParsingService.ts";
import { _setStorageRootForTesting } from "./pod/solidUtils.ts";
import { makeFakeSession } from "./testing/fakeSession.ts";

// Offline fixtures for a single Pod. The fake Session below serves these by URL
// so fetchAndParseData runs end-to-end with no network. WebID resolves to:
//   storageRoot       = https://pod.example/
//   podBaseUri        = https://pod.example/profile/
//   buildings/ (own)  = https://pod.example/granergize/buildings/
// Own buildings are discovered by LISTING the buildings/ container (ldp:contains).
const WEBID = "https://pod.example/profile/card#me";
// Storage root is normally resolved from pim:storage at login; prime it here since
// these tests call fetchAndParseData directly (no login/resolveStorageRoot step).
_setStorageRootForTesting(WEBID, "https://pod.example/");
const BUILDINGS_CONTAINER = "https://pod.example/granergize/buildings/";
const PREFS_URL = "https://pod.example/granergize/prefs.ttl";
const BUILDINGS_URL = "https://pod.example/buildings.ttl";
// Annual cons:EnergyDataset resources — the slug `<year>-P1Y` is self-describing.
const ENERGY_B1_URL = "https://pod.example/energy/b1/2024-P1Y.ttl";
const ENERGY_B2_URL = "https://pod.example/energy/b2/2024-P1Y.ttl";

const CONS = "https://solid.ti.rw.fau.de/gra/consumption.ttl#";
// The buildings file holds TWO buildings (a legacy multi-building document with
// meaningful fragments). Own buildings get storage-root-RELATIVE ids.
const B1_ID = "buildings.ttl#building-1";
const B2_ID = "buildings.ttl#building-2";

/** An annual aggregate cons:EnergyDataset declaring one electricity figure. */
const annualDataset = (kwh: number) => `
@prefix cons: <${CONS}> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn: <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
  cons:granularity "P1Y" ;
  cons:scenario cons:Actual ;
  sosa:phenomenonTime [ a time:Interval ;
    time:hasBeginning "2024-01-01"^^xsd:date ; time:hasEnd "2024-12-31"^^xsd:date ] ;
  sosa:hasMember [ a sosa:Observation ;
    sosa:observedProperty cons:ElectricityConsumption ;
    sosa:hasResult [ sosa:hasSimpleResult "${kwh}"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ] .
`;

const FIXTURES: Record<string, string> = {
  // The buildings/ container lists the user's own building file(s).
  [BUILDINGS_CONTAINER]: `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${BUILDINGS_CONTAINER}> ldp:contains <${BUILDINGS_URL}> .
`,
  // Present but empty: no current room, no hidden buildings.
  [PREFS_URL]: "",
  [BUILDINGS_URL]: `
@prefix cons: <${CONS}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#building-1> a rec:Building ;
  geo:lat 49.0 ;
  geo:long 11.0 ;
  cons:hasEnergyDataset <${ENERGY_B1_URL}#ds> .
<#building-2> a rec:Building ;
  geo:lat 49.5 ;
  geo:long 11.5 ;
  cons:hasEnergyDataset <${ENERGY_B2_URL}#ds> .
`,
  [ENERGY_B1_URL]: annualDataset(1000),
  [ENERGY_B2_URL]: annualDataset(2000),
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
  return makeFakeSession({
    webId: WEBID,
    resources: fixtures,
    // Observe-and-fall-through: hold each energy fetch open so overlapping
    // (concurrent) fetches are visible in the log.
    respond: async (url) => {
      if (url.startsWith("https://pod.example/energy/")) {
        log.energyInFlight++;
        log.maxEnergyInFlight = Math.max(log.maxEnergyInFlight, log.energyInFlight);
        await new Promise((r) => setTimeout(r, delayMs));
        log.energyInFlight--;
        log.energyResolved++;
      }
      return undefined;
    },
  }).session;
}

function newLog(): FetchLog {
  return { energyInFlight: 0, maxEnergyInFlight: 0, energyResolved: 0 };
}

Deno.test("fetchAndParseData parses own buildings (by listing) and energy end-to-end", async () => {
  const result = await fetchAndParseData(makeSession({ log: newLog() }));

  assert.equal(result.buildings.length, 2);
  const b1 = result.buildings.find((b) => b.id === B1_ID);
  assert.ok(b1, "building 1 present");
  assert.equal(b1!.lat, 49.0);
  assert.equal(b1!.long, 11.0);
  assert.equal(b1!.isShared, false); // discovered under the storage root = own

  const e1 = result.energyNeed.find((e) => e.id === B1_ID);
  const e2 = result.energyNeed.find((e) => e.id === B2_ID);
  assert.equal(e1?.energyNeed.Electricity, 1000);
  assert.equal(e2?.energyNeed.Electricity, 2000);

  // Average across both buildings.
  assert.equal(result.averages.Electricity, 1500);
});

Deno.test("fetchAndParseData fetches energy files concurrently, not serially", async () => {
  const log = newLog();
  await fetchAndParseData(makeSession({ log }));

  assert.equal(log.energyResolved, 2);
  // Serial loading would peak at 1 in-flight energy fetch; concurrent peaks at 2.
  assert.equal(log.maxEnergyInFlight, 2);
});

Deno.test("fetchAndParseData reports buildings before energy resolves", async () => {
  const log = newLog();
  let phase1Fired = false;
  let phase1Buildings = -1;
  let energyResolvedAtPhase1 = -1;

  await fetchAndParseData(makeSession({ log }), (partial) => {
    phase1Fired = true;
    phase1Buildings = partial.buildings.length;
    energyResolvedAtPhase1 = log.energyResolved;
  });

  assert.ok(phase1Fired, "phase-1 callback fired");
  assert.equal(phase1Buildings, 2);
  // The whole point of the two-phase load: buildings are handed over before any
  // energy file has finished loading.
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
  const e1 = result.energyNeed.find((e) => e.id === B1_ID);
  const e2 = result.energyNeed.find((e) => e.id === B2_ID);
  assert.equal(e1?.energyNeed.Electricity, 1000);
  assert.equal(e2, undefined);
  assert.equal(result.averages.Electricity, 1000);
});

Deno.test("fetchAndParseData throws SessionExpiredError when sources return 401", async () => {
  // Token expired: the building source 401s. fetchAndParseData must signal this
  // distinctly so the caller keeps prior data instead of blanking the map.
  const { session } = makeFakeSession({
    webId: WEBID,
    resources: FIXTURES,
    respond: (url) =>
      url === BUILDINGS_URL
        ? new Response(null, { status: 401, statusText: "Unauthorized" })
        : undefined,
  });

  await assert.rejects(
    () => fetchAndParseData(session),
    SessionExpiredError,
  );
});

Deno.test("loadBuildings surfaces a transiently-failed source without pruning it", async () => {
  // Two OWN building files; one source 500s (a slow/throttled Pod shedding a
  // connection). The healthy building must still load, the failure must be
  // REPORTED (transientFailures) for the user notice, and — unlike a 403/404 —
  // it must NOT be pruned, so it gets another chance on the next refresh.
  const C = "https://pod.example/granergize/buildings/";
  const B_OK = `${C}ok.ttl`;
  const B_FLAKY = `${C}flaky.ttl`;
  const building = `@prefix rec: <https://w3id.org/rec#> .
<#b> a rec:Building .`;
  const { session } = makeFakeSession({
    webId: WEBID,
    resources: {
      [C]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${C}> ldp:contains <${B_OK}>, <${B_FLAKY}> .`,
      [PREFS_URL]: "",
      [B_OK]: building,
      [B_FLAKY]: building,
    },
    respond: (url) =>
      url === B_FLAKY
        ? new Response("boom", { status: 500, statusText: "Server Error" })
        : undefined,
  });

  const res = await loadBuildings(session, [], new Set());

  assert.equal(res.buildings.length, 1); // the healthy source still loaded
  assert.deepEqual(res.prunedSources, []); // 500 is transient — never pruned
  assert.deepEqual(res.transientFailures, [B_FLAKY]); // …but it IS surfaced
});

// --- Operator average (Betreiber-Durchschnitt) ---------------------------------
// The energy view benchmarks a building against the mean consumption of all
// buildings of the SAME operator (rec:operatedBy). loadEnergy groups by operator
// WebID; the Energy tab renders it as the "Operator average" column. Two operator
// WebIDs to assign per case (b1 = 1000 kWh, b2 = 2000 kWh from the shared fixture).
const OP_A = "https://op.example/a/profile/card#me";
const OP_B = "https://op.example/b/profile/card#me";

/** The own-buildings file with an explicit operator per building. */
const buildingsWithOperators = (op1: string, op2: string) => `
@prefix cons: <${CONS}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#building-1> a rec:Building ;
  geo:lat 49.0 ; geo:long 11.0 ;
  rec:operatedBy <${op1}> ;
  cons:hasEnergyDataset <${ENERGY_B1_URL}#ds> .
<#building-2> a rec:Building ;
  geo:lat 49.5 ; geo:long 11.5 ;
  rec:operatedBy <${op2}> ;
  cons:hasEnergyDataset <${ENERGY_B2_URL}#ds> .
`;

Deno.test("loadEnergy averages same-operator buildings into one operator benchmark", async () => {
  const fixtures = {
    ...FIXTURES,
    [BUILDINGS_URL]: buildingsWithOperators(OP_A, OP_A),
  };
  const result = await fetchAndParseData(makeSession({ log: newLog(), fixtures }));

  // Both buildings share OP_A: its average is the mean of 1000 and 2000.
  assert.equal(result.operatorAverages[OP_A]?.Electricity, 1500);
  // A single owner's portfolio mean coincides with the operator mean here.
  assert.equal(result.portfolioAverages.Electricity, 1500);
});

Deno.test("loadEnergy publishes NO operator average for a single-building operator (no self-benchmark)", async () => {
  // Two distinct operators with one building each. A single-building "mean" IS
  // the building's own figure dressed up as a benchmark — and it would win the
  // comparison-reference precedence over the portfolio mean, silently disabling
  // the deviation tint. A metric needs ≥2 contributing buildings to publish.
  const fixtures = {
    ...FIXTURES,
    [BUILDINGS_URL]: buildingsWithOperators(OP_A, OP_B),
  };
  const result = await fetchAndParseData(makeSession({ log: newLog(), fixtures }));

  assert.equal(result.operatorAverages[OP_A], undefined);
  assert.equal(result.operatorAverages[OP_B], undefined);
});

Deno.test("loadEnergy yields no operator average when buildings have no operator", async () => {
  // The default fixture's buildings carry no rec:operatedBy.
  const result = await fetchAndParseData(makeSession({ log: newLog() }));
  assert.equal(Object.keys(result.operatorAverages).length, 0);
});

Deno.test("loadEnergy records the year the figures cover on each EnergyType", async () => {
  // The energy heading renders this ("Energy Need … in <year>") — it must be
  // the year actually loaded, never a hardcoded one.
  const result = await fetchAndParseData(makeSession({ log: newLog() }));
  for (const e of result.energyNeed) assert.equal(e.year, 2024);
});

Deno.test("loadEnergy falls back to the next-newest accessible year when the latest is unreadable", async () => {
  // A per-year share grants only some years: the newest LINKED dataset can be
  // forbidden/missing for the recipient while an older granted year is fine.
  // Building 1 links 2024 (unreadable — not in the fixtures) and 2023 (500 kWh):
  // the fold must use 2023, not show "no energy data".
  const b1y2023 = "https://pod.example/energy/b1/2023-P1Y.ttl";
  const fixtures: Record<string, string> = {
    ...FIXTURES,
    [BUILDINGS_URL]: `
@prefix cons: <${CONS}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#building-1> a rec:Building ;
  geo:lat 49.0 ; geo:long 11.0 ;
  cons:hasEnergyDataset <${ENERGY_B1_URL}#ds> , <${b1y2023}#ds> .
`,
    [b1y2023]: annualDataset(500),
  };
  delete fixtures[ENERGY_B1_URL]; // the linked 2024 dataset is not readable
  delete fixtures[ENERGY_B2_URL];

  const result = await fetchAndParseData(makeSession({ log: newLog(), fixtures }));
  const b1 = result.energyNeed[0];
  assert.ok(b1, "building 1 still carries energy");
  assert.equal(b1.energyNeed["Electricity"], 500, "older year's figure used");
  assert.equal(b1.year, 2023, "the year reflects the fallback");
});
