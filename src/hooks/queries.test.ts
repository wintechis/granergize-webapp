/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  energyKeyFor,
  useBuildings,
  useEnergy,
  useResolveOrgLogo,
  useSolidData,
} from "./queries.ts";
import type { BuildingType } from "../types.ts";
import { useCheckInbox, useToggleVisibility } from "./mutations.ts";
import { _setSessionForTesting } from "./session.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { _resetProfileCacheForTesting } from "../services/pod/profileDocument.ts";

const GRAN = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";
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
  [REG]: `@prefix gran: <${GRAN}> .
<${REG}> a gran:DataSourceRegistry .`,
  [PREFS]: "",
  [SHARING]: "",
  [B1]: `@prefix gran: <${GRAN}> .
@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#b1> a rec:Building ; geo:lat 49.0 ; geo:long 11.0 ;
  gran:hasEnergyDataset <${ENERGY}#ds> .`,
  [ENERGY]: `@prefix gran: <${GRAN}> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn: <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#ds> a gran:EnergyDataset , sosa:ObservationCollection ;
  gran:granularity "P1Y" ; gran:scenario gran:Actual ;
  sosa:phenomenonTime [ a time:Interval ;
    time:hasBeginning "2024-01-01"^^xsd:date ; time:hasEnd "2024-12-31"^^xsd:date ] ;
  sosa:hasMember [ a sosa:Observation ;
    sosa:observedProperty gran:ElectricityConsumption ;
    sosa:hasResult [ sosa:hasSimpleResult "1000"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ] .`,
};

/** A fake logged-in session serving the fixtures above (query string ignored). */
function fakeSession(store: Record<string, string> = { ...FIXTURES }): Session {
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[url] = String(init.body);
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === "DELETE") {
      delete store[url];
      return Promise.resolve(new Response(null, { status: 205 }));
    }
    const body = store[url];
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
  return {
    info: { webId: WEBID, isLoggedIn: true },
    fetch,
  } as unknown as Session;
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
  const mk = (id: number, datasets: BuildingType["energyDatasets"]): BuildingType =>
    ({ id, uri: `urn:b${id}`, energyDatasets: datasets } as BuildingType);

  // Same building set, but one building gains an energy-dataset link: the key
  // MUST change, else the bulk energy read stays stale after an energy write.
  const before = energyKeyFor([mk(1, []), mk(2, [])]);
  const after = energyKeyFor([
    mk(1, [{ url: "u", year: 2099, granularity: "P1Y", scenario: "actual" }]),
    mk(2, []),
  ]);
  assert.notEqual(before, after);

  // Stable under building order and dataset order (so it doesn't churn spuriously).
  const a = energyKeyFor([
    mk(2, []),
    mk(1, [
      { url: "u", year: 2099, granularity: "P1Y", scenario: "actual" },
      { url: "v", year: 2098, granularity: "P1Y", scenario: "planned" },
    ]),
  ]);
  const b = energyKeyFor([
    mk(1, [
      { url: "v", year: 2098, granularity: "P1Y", scenario: "planned" },
      { url: "u", year: 2099, granularity: "P1Y", scenario: "actual" },
    ]),
    mk(2, []),
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

Deno.test("useToggleVisibility invalidates the shared-with-me query", async () => {
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
    assert.ok(
      invalidated.some((k) => Array.isArray(k) && k[0] === "sharedWithMe"),
      "sharedWithMe was invalidated",
    );
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
    // receivedBenchmarks folds receivedViews, so invalidating only the latter left
    // a newly-received benchmark stale — both must be invalidated by the drain.
    assert.ok(keyed("receivedViews"), "receivedViews was invalidated");
    assert.ok(keyed("receivedBenchmarks"), "receivedBenchmarks was invalidated");
  } finally {
    _setSessionForTesting(null);
  }
});
