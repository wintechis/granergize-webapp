/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  energyKeyFor,
  useAnnualEnergy,
  useBuildings,
  useEnergy,
  useReceivedBenchmarks,
  useReceivedViews,
  useResolveOrgLogo,
  useSeriesDays,
  useSharedWithMe,
  useSolidData,
} from "./queries.ts";
import type { BuildingType } from "../types.ts";
import { useCheckInbox, useToggleVisibility } from "./mutations.ts";
import { _setSessionForTesting } from "./session.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { _resetProfileCacheForTesting } from "../services/pod/profileDocument.ts";
import { makeFakeSession } from "../services/testing/fakeSession.ts";

const CONS = "https://solid.ti.rw.fau.de/gra/consumption.ttl#";
const WEBID = "https://pod.example/profile/card#me";
const PROFILE = "https://pod.example/profile/card";
const REG = "https://pod.example/granergize/dataSources.ttl";
const PREFS = "https://pod.example/granergize/prefs.ttl";
const SHARING = "https://pod.example/granergize/sharingRegistry.ttl";
const B1 = "https://pod.example/granergize/buildings/b1.ttl";
const BUILDINGS_CONTAINER = "https://pod.example/granergize/buildings/";
const ENERGY = "https://pod.example/granergize/buildings/b1/energy/2024-P1Y.ttl";

const FIXTURES: Record<string, string> = {
  [PROFILE]: `@prefix space: <http://www.w3.org/ns/pim/space#> .
<#me> space:storage </> .`,
  // Own buildings are discovered by listing the buildings/ container.
  [BUILDINGS_CONTAINER]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${BUILDINGS_CONTAINER}> ldp:contains <${B1}> .`,
  // dataSources.ttl now holds only shared-in sources (none here).
  [REG]: `@prefix cons: <${CONS}> .
<${REG}> a cons:DataSourceRegistry .`,
  [PREFS]: "",
  [SHARING]: "",
  [B1]: `@prefix cons: <${CONS}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#b1> a rec:Building ; geo:lat 49.0 ; geo:long 11.0 ;
  cons:hasEnergyDataset <${ENERGY}#ds> .`,
  [ENERGY]: `@prefix cons: <${CONS}> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn: <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
  cons:granularity "P1Y" ; cons:scenario cons:Actual ;
  sosa:phenomenonTime [ a time:Interval ;
    time:hasBeginning "2024-01-01"^^xsd:date ; time:hasEnd "2024-12-31"^^xsd:date ] ;
  sosa:hasMember [ a sosa:Observation ;
    sosa:observedProperty cons:ElectricityConsumption ;
    sosa:hasResult [ sosa:hasSimpleResult "1000"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ] .`,
};

/** A fake logged-in session serving the fixtures above (query string ignored). */
function fakeSession(store: Record<string, string> = FIXTURES): Session {
  return makeFakeSession({ webId: WEBID, resources: store }).session;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

Deno.test("useBuildings loads + parses from the session", async () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useBuildings(), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    assert.equal(result.current.data?.buildings.length, 1);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("one shared-in fold serves buildings + sharedWithMe + receivedViews + benchmarks", async () => {
  const SHARED_IN = "https://pod.example/granergize/shared-in/";
  const EVT = `${SHARED_IN}evt-1`;
  const B2 = "https://other.example/granergize/buildings/b2.ttl";
  const fixtures: Record<string, string> = {
    ...FIXTURES,
    [SHARED_IN]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${SHARED_IN}> ldp:contains <${EVT}> .`,
    [EVT]: `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix gran: <https://solid.ti.rw.fau.de/gra/vocab.ttl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessGrant ;
   prov:wasAssociatedWith <https://other.example/profile/card#me> ;
   interop:grantee <${WEBID}> ;
   interop:forResource <${B2}#b2> ;
   gran:kind <https://w3id.org/rec#Building> ;
   prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime .`,
    [B2]: `@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#b2> a rec:Building ; geo:lat 50.0 ; geo:long 10.0 .`,
  };
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  const { session, calls } = makeFakeSession({
    webId: WEBID,
    resources: fixtures,
  });
  _setSessionForTesting(session);
  const { wrapper } = makeWrapper();
  try {
    // Mount EVERY shared-in consumer at once — the dedup's whole point.
    const { result } = renderHook(() => ({
      buildings: useBuildings(),
      sharedWithMe: useSharedWithMe(),
      receivedViews: useReceivedViews(),
      benchmarks: useReceivedBenchmarks(),
    }), { wrapper });
    await waitFor(() => {
      assert.ok(result.current.buildings.isSuccess);
      assert.ok(result.current.benchmarks.isSuccess);
      assert.ok(result.current.sharedWithMe.data);
    });
    // The shared grant flowed into every reader…
    assert.equal(result.current.buildings.data?.buildings.length, 2);
    assert.equal(result.current.sharedWithMe.data?.length, 1);
    assert.equal(result.current.sharedWithMe.data?.[0].buildingUri, `${B2}#b2`);
    assert.deepEqual(result.current.receivedViews.data, []);
    // …from ONE fold: the shared-in/ container was listed exactly once.
    const folds = calls.filter(
      (c) => c.method === "GET" && c.url === SHARED_IN,
    );
    assert.equal(folds.length, 1, "shared-in/ folded once for all consumers");
    // …and prefs.ttl was read exactly once (the `prefs` query): the buildings
    // load takes the hidden set as a parameter instead of re-fetching it.
    const prefsReads = calls.filter(
      (c) => c.method === "GET" && c.url === PREFS,
    );
    assert.equal(prefsReads.length, 1, "prefs.ttl read once for all consumers");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useSolidData merges phase-1 buildings + phase-2 energy", async () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useSolidData(), { wrapper });
    await waitFor(() => assert.equal(result.current.buildings.length, 1));
    await waitFor(() => assert.equal(result.current.energyNeed.length, 1));
    assert.equal(result.current.energyNeed[0].energyNeed.Electricity, 1000);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("energyKeyFor changes when a building's dataset links change (not only its id set)", () => {
  const mk = (id: string, datasets: BuildingType["energyDatasets"]): BuildingType =>
    ({ id, uri: `urn:b${id}`, type: "x", energyDatasets: datasets } as BuildingType);

  // Same building set, but one building gains an energy-dataset link: the key
  // MUST change, else the bulk energy read stays stale after an energy write.
  const before = energyKeyFor([mk("1", []), mk("2", [])]);
  const after = energyKeyFor([
    mk("1", [{ url: "u", year: 2099, granularity: "P1Y", scenario: "actual" }]),
    mk("2", []),
  ]);
  assert.notEqual(before, after);

  // Stable under building order and dataset order (so it doesn't churn spuriously).
  const a = energyKeyFor([
    mk("2", []),
    mk("1", [
      { url: "u", year: 2099, granularity: "P1Y", scenario: "actual" },
      { url: "v", year: 2098, granularity: "P1Y", scenario: "planned" },
    ]),
  ]);
  const b = energyKeyFor([
    mk("1", [
      { url: "v", year: 2098, granularity: "P1Y", scenario: "planned" },
      { url: "u", year: 2099, granularity: "P1Y", scenario: "actual" },
    ]),
    mk("2", []),
  ]);
  assert.equal(a, b);
  assert.equal(energyKeyFor(undefined), "");
});

Deno.test("useEnergy is disabled until buildings are provided", () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useEnergy(undefined), { wrapper });
    assert.equal(result.current.fetchStatus, "idle"); // not fetching (disabled)
    assert.equal(result.current.data, undefined);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useResolveOrgLogo resolves the producer's org logo", async () => {
  _resetProfileCacheForTesting();
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  const store = {
    [PROFILE]: `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix org: <http://www.w3.org/ns/org#> .
<#me> org:memberOf <#org> .
<#org> foaf:logo <https://pod.example/profile/logo.png> .`,
  };
  _setSessionForTesting(fakeSession(store));
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useResolveOrgLogo(WEBID), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    assert.equal(result.current.data, "https://pod.example/profile/logo.png");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useResolveOrgLogo is disabled until a WebID is provided", () => {
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useResolveOrgLogo(undefined), {
      wrapper,
    });
    assert.equal(result.current.fetchStatus, "idle");
    assert.equal(result.current.data, undefined);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useToggleVisibility invalidates ONLY prefs (buildings re-keys off the hidden set)", async () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { client, wrapper } = makeWrapper();
  const invalidated: unknown[] = [];
  const orig = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((arg: Parameters<typeof orig>[0]) => {
    invalidated.push((arg as { queryKey?: unknown } | undefined)?.queryKey);
    return orig(arg);
  }) as typeof client.invalidateQueries;

  try {
    const { result } = renderHook(() => useToggleVisibility(), { wrapper });
    await result.current.mutateAsync("https://other.example/b.ttl#b");
    const keyed = (name: string) =>
      invalidated.some((k) => Array.isArray(k) && k[0] === name);
    // The toggle writes prefs.ttl; the Share-tab list derives from the prefs
    // query, and the buildings query keys on the hidden set, so the prefs
    // refetch re-keys it — a second buildings invalidation would double-load.
    assert.ok(keyed("prefs"), "prefs was invalidated");
    assert.ok(!keyed("buildings"), "no redundant buildings invalidation");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useCheckInbox invalidates the received-benchmarks fold (not just received-views)", async () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { client, wrapper } = makeWrapper();
  const invalidated: unknown[] = [];
  const orig = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((arg: Parameters<typeof orig>[0]) => {
    invalidated.push((arg as { queryKey?: unknown } | undefined)?.queryKey);
    return orig(arg);
  }) as typeof client.invalidateQueries;

  try {
    const { result } = renderHook(() => useCheckInbox(), { wrapper });
    // drainInbox may resolve or reject against the offline fixture; either way the
    // mutation settles and onSettled runs. We assert on the invalidations only.
    await result.current.mutateAsync().catch(() => {});
    const keyed = (name: string) =>
      invalidated.some((k) => Array.isArray(k) && k[0] === name);
    // The drain refolds the one shared-in log (every "shared with me" reader
    // derives from it) AND receivedBenchmarks — snapshot contents can change
    // while the grant set (the benchmarks query's key fingerprint) does not.
    assert.ok(keyed("sharedInLog"), "sharedInLog was invalidated");
    assert.ok(keyed("receivedBenchmarks"), "receivedBenchmarks was invalidated");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useAnnualEnergy splits actual vs planned, sorted by year", async () => {
  const PLANNED = ENERGY.replace("2024-P1Y.ttl", "2024-P1Y-planned.ttl");
  const EARLIER = ENERGY.replace("2024-P1Y.ttl", "2023-P1Y.ttl");
  const ds = (year: number, value: number, scenario: string) =>
    `@prefix cons: <${CONS}> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn: <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
  cons:granularity "P1Y" ; cons:scenario cons:${scenario} ;
  sosa:phenomenonTime [ a time:Interval ;
    time:hasBeginning "${year}-01-01"^^xsd:date ;
    time:hasEnd "${year}-12-31"^^xsd:date ] ;
  sosa:hasMember [ a sosa:Observation ;
    sosa:observedProperty cons:ElectricityConsumption ;
    sosa:hasResult [ sosa:hasSimpleResult "${value}"^^xsd:decimal ] ] .`;
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession({
    ...FIXTURES,
    [PLANNED]: ds(2024, 900, "Planned"),
    [EARLIER]: ds(2023, 800, "Actual"),
  }));
  const { wrapper } = makeWrapper();
  const building = {
    id: "b1",
    uri: `${B1}#b1`,
    energyDatasets: [
      { url: `${ENERGY}#ds`, year: 2024, granularity: "P1Y", scenario: "actual" },
      { url: `${EARLIER}#ds`, year: 2023, granularity: "P1Y", scenario: "actual" },
      { url: `${PLANNED}#ds`, year: 2024, granularity: "P1Y", scenario: "planned" },
      // A 15-min series ref must be ignored (annual view only).
      { url: `${ENERGY}#s`, year: 2024, granularity: "PT15M", scenario: "actual" },
    ],
  } as unknown as BuildingType;
  try {
    const { result } = renderHook(() => useAnnualEnergy(building), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    const { actual, planned } = result.current.data!;
    assert.deepEqual(actual.map((d) => d.year), [2023, 2024], "sorted actual");
    assert.equal(actual[0].electricityConsumption, 800);
    assert.equal(actual[1].electricityConsumption, 1000);
    assert.deepEqual(planned.map((d) => d.year), [2024]);
    assert.equal(planned[0].electricityConsumption, 900);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useSeriesDays lists the day files behind series refs, sorted", async () => {
  const SERIES = "https://pod.example/granergize/buildings/b1/energy/2024-PT15M.ttl";
  const CONTAINER = SERIES.replace(/\.ttl$/, "/");
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession({
    ...FIXTURES,
    [CONTAINER]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> ldp:contains <${CONTAINER}2024-01-02.ttl>,
  <${CONTAINER}2024-01-01.ttl> .`,
  }));
  const { wrapper } = makeWrapper();
  const refs = [
    { url: `${SERIES}#ds`, year: 2024, granularity: "PT15M", scenario: "actual" as const },
  ];
  try {
    const { result } = renderHook(() => useSeriesDays(refs), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    assert.deepEqual(result.current.data, [
      { day: "2024-01-01", url: `${CONTAINER}2024-01-01.ttl` },
      { day: "2024-01-02", url: `${CONTAINER}2024-01-02.ttl` },
    ]);
  } finally {
    _setSessionForTesting(null);
  }
});
