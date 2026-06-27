/// <reference lib="deno.ns" />
import { sessionGateway } from "../pod/podGateway.ts";
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";
import {
  createAggregationDefinition,
  deleteAggregation,
  getAggregationDefinition,
  getAggregationDefinitions,
  getSnapshotUri,
  loadComputedSnapshot,
  storeComputedSnapshot,
} from "./aggregation.ts";
import { CONSUMPTION_NS, SOSA_NS } from "../rdf/vocabularies.ts";

const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");
const AGGREGATIONS = "https://pod.example/granergize/aggregations/";
const SNAPSHOTS = "https://pod.example/granergize/aggregations/snapshots/";
const CONS = "https://solid.ti.rw.fau.de/gra/consumption.ttl#";

/**
 * A stateful fake Pod: PUT/DELETE mutate an in-memory store; a GET of a container
 * (URL ending "/") synthesizes an `ldp:contains` listing of its direct children,
 * so the container-native discovery (list `aggregations/`) runs offline (the helper's
 * `listContainers` mode; containers also HEAD 200, so ensure-dirs is a no-op).
 */
const makeSession = () => makeFakeSession({ webId: WEBID, listContainers: true });

function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

Deno.test("createAggregationDefinition writes one aggregations/<id>.ttl resource", async () => {
  const { session, store } = makeSession();
  const aggregation = await createAggregationDefinition(
    session,
    "My aggregation",
    ["https://pod.example/granergize/buildings/b1.ttl#b1"],
    "average",
    ["electricity"],
  );

  const defUri = `${AGGREGATIONS}${aggregation.id}.ttl`;
  assert.ok(store[defUri], "the definition resource was PUT under aggregations/");
  const s = parse(store[defUri]);
  assert.equal(
    s.getQuads(null, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${CONS}AggregationDefinition`, null).length,
    1,
  );
  assert.equal(s.getObjects(null, `${CONS}aggregationName`, null)[0]?.value, "My aggregation");
  assert.equal(s.getObjects(null, `${CONS}includesMetric`, null)[0]?.value, "electricity");
});

Deno.test("getAggregationDefinitions lists the container and parses each aggregation", async () => {
  const { session } = makeSession();
  const v1 = await createAggregationDefinition(session, "A", [], "average", ["heatConsumption"]);
  const v2 = await createAggregationDefinition(session, "B", [], "sum", ["water"]);

  const aggregations = await getAggregationDefinitions(session);
  assert.equal(aggregations.length, 2);
  const names = aggregations.map((v) => v.name).sort();
  assert.deepEqual(names, ["A", "B"]);
  // Round-trips a single aggregation by id, too.
  const got = await getAggregationDefinition(session, v1.id);
  assert.equal(got?.name, "A");
  assert.equal(got?.id, v1.id);
  assert.ok(v2.id !== v1.id);
});

Deno.test("getAggregationDefinitions ignores the snapshots/ subfolder", async () => {
  const { session } = makeSession();
  const v = await createAggregationDefinition(session, "A", [], "average", ["heatConsumption"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 3,
    metrics: ["heatConsumption"],
    values: { heatConsumption:1234.5 },
  });

  // Snapshot landed under snapshots/, and the def now records lastComputedAt.
  const aggregations = await getAggregationDefinitions(session);
  assert.equal(aggregations.length, 1, "the snapshots/ subfolder is not an aggregation");
  assert.equal(aggregations[0].lastComputedAt, "2026-06-04T10:00:00Z");
});

Deno.test("storeComputedSnapshot writes the shareable snapshot under snapshots/", async () => {
  const { session, store } = makeSession();
  const v = await createAggregationDefinition(session, "A", [], "average", [
    "heatConsumption",
  ]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 3,
    metrics: ["heatConsumption"],
    values: { heatConsumption: 1234.5 },
  });

  const snapUri = getSnapshotUri(WEBID, v.id);
  assert.equal(snapUri, `${SNAPSHOTS}${v.id}.ttl`);
  const s = parse(store[snapUri]);
  assert.equal(s.getObjects(null, `${CONS}buildingCount`, null)[0]?.value, "3");
  // The snapshot collapsed into a sosa:ObservationCollection: each value is a
  // member observation (same shape as an energy dataset), not a `*Value` literal.
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  assert.equal(
    s.getQuads(null, RDF_TYPE, `${SOSA_NS}ObservationCollection`, null).length,
    1,
  );
  assert.equal(s.getObjects(null, `${SOSA_NS}hasMember`, null).length, 1);
  // Full precision — the ground value is no longer rounded; it round-trips through
  // the member observation back to the same metric key/value.
  const loaded = await loadComputedSnapshot(session, snapUri);
  assert.equal(loaded?.values.heatConsumption, 1234.5);
});

Deno.test("benchmark snapshot round-trips its result fields and stays a snapshot", async () => {
  const { session, store } = makeSession();
  const v = await createAggregationDefinition(session, "Bench", [], "average", [
    "electricityConsumption",
  ]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "Bench",
    aggregationType: "average",
    computedAt: "2026-06-08T10:00:00Z",
    buildingCount: 4,
    metrics: ["electricityConsumption"],
    values: { electricityConsumption: 1410 },
    isBenchmark: true,
    computedBy: "https://bsp.pod/profile/card#me",
    metricPeriod: "2024",
  });

  // The Turtle carries both rdf:types and the two benchmark predicates.
  const snapUri = getSnapshotUri(WEBID, v.id);
  const s = parse(store[snapUri]);
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  assert.equal(
    s.getQuads(null, RDF_TYPE, `${CONS}AggregationSnapshot`, null).length,
    1,
    "still a gra:AggregationSnapshot (existing readers keep working)",
  );
  assert.equal(
    s.getQuads(null, RDF_TYPE, `${CONSUMPTION_NS}BenchmarkResult`, null).length,
    1,
  );
  assert.equal(
    s.getObjects(null, `${CONSUMPTION_NS}computedBy`, null)[0]?.value,
    "https://bsp.pod/profile/card#me",
  );
  assert.equal(
    s.getObjects(null, `${CONSUMPTION_NS}metricPeriod`, null)[0]?.value,
    "2024",
  );

  // And loadComputedSnapshot reads them back.
  const loaded = await loadComputedSnapshot(session, snapUri);
  assert.equal(loaded?.isBenchmark, true);
  assert.equal(loaded?.computedBy, "https://bsp.pod/profile/card#me");
  assert.equal(loaded?.metricPeriod, "2024");
  assert.equal(loaded?.values.electricityConsumption, 1410);
});

Deno.test("a plain (non-benchmark) snapshot has no benchmark fields", async () => {
  const { session } = makeSession();
  const v = await createAggregationDefinition(session, "Plain", [], "average", ["heatConsumption"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "Plain",
    aggregationType: "average",
    computedAt: "2026-06-08T10:00:00Z",
    buildingCount: 2,
    metrics: ["heatConsumption"],
    values: { heatConsumption:5 },
  });
  const loaded = await loadComputedSnapshot(session, getSnapshotUri(WEBID, v.id));
  assert.equal(loaded?.isBenchmark, undefined);
  assert.equal(loaded?.computedBy, undefined);
  assert.equal(loaded?.metricPeriod, undefined);
});

Deno.test("createAggregationDefinition persists the benchmark flag and round-trips it", async () => {
  // The flag is ground truth for the snapshot's bench:BenchmarkResult typing —
  // every recompute derives from it, so a plain refresh can't strip it.
  const { session, store } = makeSession();
  const v = await createAggregationDefinition(session, "Bench", [], "average", [
    "electricityConsumption",
  ], { benchmark: true });
  assert.equal(v.benchmark, true);

  const s = parse(store[`${AGGREGATIONS}${v.id}.ttl`]);
  assert.equal(s.getObjects(null, `${CONS}benchmark`, null)[0]?.value, "true");

  const got = await getAggregationDefinition(session, v.id);
  assert.equal(got?.benchmark, true);
  // And a plain definition stays unflagged.
  const plain = await createAggregationDefinition(session, "P", [], "average", ["heatConsumption"]);
  assert.equal((await getAggregationDefinition(session, plain.id))?.benchmark, undefined);
});

Deno.test("spatial extent round-trips on a definition (Turtle + parse)", async () => {
  const { session, store } = makeSession();
  const extent = {
    region: "https://wunderfacts.com/lau/ags/09564",
    level: "gemeinde",
  };
  const v = await createAggregationDefinition(
    session,
    "Nürnberg avg",
    [],
    "average",
    ["heatConsumption"],
    { spatialExtent: extent },
  );
  assert.deepEqual(v.spatialExtent, extent);

  // Serialised as a region object-property + a level literal.
  const s = parse(store[`${AGGREGATIONS}${v.id}.ttl`]);
  assert.equal(s.getObjects(null, `${CONS}spatialExtent`, null)[0]?.value, extent.region);
  assert.equal(s.getObjects(null, `${CONS}extentLevel`, null)[0]?.value, extent.level);

  // And parses back.
  assert.deepEqual((await getAggregationDefinition(session, v.id))?.spatialExtent, extent);

  // A definition without a region carries none (no migration; the field stays optional).
  const plain = await createAggregationDefinition(session, "P", [], "average", ["water"]);
  assert.equal((await getAggregationDefinition(session, plain.id))?.spatialExtent, undefined);
});

Deno.test("spatial extent round-trips on a (self-sufficient) snapshot", async () => {
  const { session } = makeSession();
  const extent = {
    region: "https://wunderfacts.com/lau/ags/09564",
    level: "gemeinde",
  };
  const v = await createAggregationDefinition(session, "A", [], "average", [
    "heatConsumption",
  ]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-18T10:00:00Z",
    buildingCount: 5,
    metrics: ["heatConsumption"],
    values: { heatConsumption: 1234.5 },
    spatialExtent: extent,
  });
  const loaded = await loadComputedSnapshot(session, getSnapshotUri(WEBID, v.id));
  assert.deepEqual(loaded?.spatialExtent, extent);

  // A snapshot without a region carries none.
  const v2 = await createAggregationDefinition(session, "B", [], "average", ["water"]);
  await storeComputedSnapshot(session, {
    id: v2.id,
    name: "B",
    aggregationType: "average",
    computedAt: "2026-06-18T10:00:00Z",
    buildingCount: 2,
    metrics: ["water"],
    values: { water: 3 },
  });
  assert.equal(
    (await loadComputedSnapshot(session, getSnapshotUri(WEBID, v2.id)))?.spatialExtent,
    undefined,
  );
});

Deno.test("loadComputedSnapshot: 404 means absence (null), a transient failure THROWS", async () => {
  // Returning null on ANY failure once made the aggregation page's auto-compute treat
  // a throttled read of an EXISTING snapshot as "no snapshot yet" and fire a
  // snapshot-overwriting recompute — a mutation triggered by a failed read.
  const { session } = makeSession(); // empty store → GET is a genuine 404
  assert.equal(
    await loadComputedSnapshot(session, `${SNAPSHOTS}aggregation-x.ttl`),
    null,
  );

  // 403 (owner revoked the recipient's access) is also "gone", not a failure.
  const forbidden = sessionGateway({
    info: { webId: WEBID, isLoggedIn: true },
    fetch: () => Promise.resolve(new Response("forbidden", { status: 403 })),
  } as unknown as Session);
  assert.equal(
    await loadComputedSnapshot(forbidden, `${SNAPSHOTS}aggregation-x.ttl`),
    null,
  );

  const throttled = sessionGateway({
    info: { webId: WEBID, isLoggedIn: true },
    fetch: () => Promise.resolve(new Response("slow down", { status: 503 })),
  } as unknown as Session);
  await assert.rejects(
    () => loadComputedSnapshot(throttled, `${SNAPSHOTS}aggregation-x.ttl`),
    /HTTP 503/,
  );
});

Deno.test("deleteAggregation removes the definition and its snapshot", async () => {
  const { session, store } = makeSession();
  const v = await createAggregationDefinition(session, "A", [], "average", ["heatConsumption"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 1,
    metrics: ["heatConsumption"],
    values: { heatConsumption:1 },
  });

  await deleteAggregation(session, v.id);

  assert.ok(!(`${AGGREGATIONS}${v.id}.ttl` in store), "definition deleted");
  assert.ok(!(`${SNAPSHOTS}${v.id}.ttl` in store), "snapshot deleted");
  assert.deepEqual(await getAggregationDefinitions(session), []);
});
