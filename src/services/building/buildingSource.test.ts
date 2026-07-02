/// <reference lib="deno.ns" />
import "../../hooks/test-dom-setup.ts"; // QueryClient pulls react-query; DOM globals first
import { strict as assert } from "node:assert";
import { QueryClient } from "@tanstack/react-query";
import { _setAppQueryClient } from "../../lib/appQueryClient.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import type { Building } from "../../types.ts";
import {
  cachedBuilding,
  cachedVisibleBuildings,
  fetchBuildingSourceShared,
  parseBuildingSource,
} from "./buildingSource.ts";
import {
  clearDatasetRegistry,
  getGraphQuads,
  graphsMentioning,
} from "../rdf/datasetRegistry.ts";

const ROOT = "https://pod.example/";
const WEBID = "https://pod.example/profile/card#me";
const PREFIXES = `@prefix rec: <https://w3id.org/rec#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .`;

Deno.test("parseBuildingSource: one source → its building, sourceUri + coords set", () => {
  const src = `${ROOT}granergize/buildings/b1.ttl`;
  const ttl = `${PREFIXES}
<${src}#it> a rec:Building ;
  geo:location [ a geo:Point ; geo:lat 49.5 ; geo:long 11.0 ] .`;
  const buildings = parseBuildingSource(ttl, src, ROOT);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].uri, `${src}#it`);
  assert.equal(buildings[0].sourceUri, src); // graph = source IRI → ownership check
  assert.equal(buildings[0].lat, 49.5);
  assert.equal(buildings[0].long, 11.0);
});

Deno.test("parseBuildingSource feeds the dataset registry (graph = source IRI)", () => {
  clearDatasetRegistry();
  const src = `${ROOT}granergize/buildings/b1.ttl`;
  const ttl = `${PREFIXES}
<${src}#it> a rec:Building ;
  geo:location [ a geo:Point ; geo:lat 49.5 ; geo:long 11.0 ] .`;
  parseBuildingSource(ttl, src, ROOT);
  assert.ok(getGraphQuads(src)?.length, "the parse recorded the source graph");
  assert.deepEqual(graphsMentioning(`${src}#it`), [src]);
  clearDatasetRegistry();
});

Deno.test("parseBuildingSource: a foreign multi-building doc yields each building", () => {
  // The parser is type-driven (rdf:type rec:Building), so one source can carry several.
  const src = "https://bob.example/granergize/buildings/multi.ttl";
  const ttl = `${PREFIXES}
<${src}#a> a rec:Building .
<${src}#b> a rec:Building .`;
  const uris = parseBuildingSource(ttl, src, ROOT).map((b) => b.uri).sort();
  assert.deepEqual(uris, [`${src}#a`, `${src}#b`]);
});

Deno.test("parseBuildingSource: reused blank-node labels don't collide across sources", () => {
  // Each source uses an identical bare [ … ] blank node for its geo:Point. Parsing each
  // in its OWN n3 Store (no aggregate parse) means the coordinates can't bleed between
  // sources — the property the old cross-source bnode scoping used to protect.
  const mk = (src: string, lat: number) => `${PREFIXES}
<${src}#it> a rec:Building ;
  geo:location [ a geo:Point ; geo:lat ${lat} ; geo:long 11.0 ] .`;
  const srcA = `${ROOT}granergize/buildings/a.ttl`;
  const srcB = `${ROOT}granergize/buildings/b.ttl`;
  const [a] = parseBuildingSource(mk(srcA, 48.1), srcA, ROOT);
  const [b] = parseBuildingSource(mk(srcB, 52.5), srcB, ROOT);
  assert.equal(a.lat, 48.1);
  assert.equal(b.lat, 52.5);
});

const SRC = `${ROOT}granergize/buildings/b1.ttl`;
const SRC_TTL = `${PREFIXES}\n<${SRC}#it> a rec:Building .`;

/** A gateway whose fetch serves SRC_TTL at SRC and counts calls. */
function countingGateway(): { gateway: PodGateway; calls: () => number } {
  let count = 0;
  const fetch = ((uri: string | URL) => {
    count++;
    return Promise.resolve(
      String(uri) === SRC
        ? new Response(SRC_TTL, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        })
        : new Response("", { status: 404 }),
    );
  }) as unknown as typeof globalThis.fetch;
  return { gateway: { fetch, webId: WEBID }, calls: () => count };
}

Deno.test("fetchBuildingSourceShared returns the source's buildings", async () => {
  _setAppQueryClient(null);
  const { gateway } = countingGateway();
  const buildings = await fetchBuildingSourceShared(SRC, gateway, ROOT);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].uri, `${SRC}#it`);
});

Deno.test("fetchBuildingSourceShared: warm cache → one fetch across consumers", async () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    const { gateway, calls } = countingGateway();
    await fetchBuildingSourceShared(SRC, gateway, ROOT);
    await fetchBuildingSourceShared(SRC, gateway, ROOT);
    assert.equal(calls(), 1, "the source file is fetched exactly once");
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});

Deno.test("fetchBuildingSourceShared: no app QueryClient still loads (direct)", async () => {
  _setAppQueryClient(null);
  const { gateway, calls } = countingGateway();
  const buildings = await fetchBuildingSourceShared(SRC, gateway, ROOT);
  assert.equal(buildings.length, 1);
  assert.equal(calls(), 1);
});

const onlyWebId: PodGateway = {
  fetch: (() => Promise.resolve(new Response(""))) as unknown as typeof globalThis.fetch,
  webId: WEBID,
};

Deno.test("cachedBuilding finds a building in the warm per-source cache", () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    qc.setQueryData<Building[]>(["buildingSource", WEBID, SRC], [
      { uri: `${SRC}#it` } as Building,
    ]);
    assert.equal(cachedBuilding(`${SRC}#it`)?.uri, `${SRC}#it`);
    assert.equal(cachedBuilding("urn:absent"), null);
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});

Deno.test("cachedBuilding: no app client → null", () => {
  _setAppQueryClient(null);
  assert.equal(cachedBuilding(`${SRC}#it`), null);
});

Deno.test("cachedVisibleBuildings: cold cache (no container) → null", () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    // A per-source entry exists but the container query never ran → don't trust a
    // partial peek; the caller falls back to a full load.
    qc.setQueryData<Building[]>(["buildingSource", WEBID, SRC], [
      { uri: `${SRC}#it` } as Building,
    ]);
    assert.equal(cachedVisibleBuildings(onlyWebId), null);
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});

Deno.test("cachedVisibleBuildings: warm cache flattens sources and drops hidden", () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    const A = `${ROOT}granergize/buildings/a.ttl`;
    const B = `${ROOT}granergize/buildings/b.ttl`;
    qc.setQueryData<string[]>(["buildingsContainer", WEBID], [A, B]);
    qc.setQueryData<Building[]>(["buildingSource", WEBID, A], [
      { uri: `${A}#it` } as Building,
    ]);
    qc.setQueryData<Building[]>(["buildingSource", WEBID, B], [
      { uri: `${B}#it` } as Building,
    ]);
    qc.setQueryData(["prefs", WEBID], { hiddenBuildings: new Set([B]) });
    const vis = cachedVisibleBuildings(onlyWebId);
    assert.equal(vis?.length, 1, "the hidden building is dropped");
    assert.equal(vis?.[0].uri, `${A}#it`);
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});
