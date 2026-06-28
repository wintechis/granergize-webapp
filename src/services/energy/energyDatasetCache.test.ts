/// <reference lib="deno.ns" />
import "../../hooks/test-dom-setup.ts"; // QueryClient pulls react-query; register DOM globals first
import { strict as assert } from "node:assert";
import { QueryClient } from "@tanstack/react-query";
import { _setAppQueryClient } from "../../lib/appQueryClient.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import {
  datasetFileUri,
  type EnergyDataset,
  serializeEnergyDataset,
} from "./energyDataset.ts";
import {
  energyDatasetKey,
  fetchEnergyDatasetShared,
} from "./energyDatasetCache.ts";

const WEBID = "https://pod.example/profile/card#me";
const ROOT = "https://pod.example/granergize/observations/";
const FILE = datasetFileUri(ROOT, 2024, "abc");
const NODE = `${FILE}#ds`;
const BUILDING = "https://pod.example/granergize/buildings/b-1.ttl#it";

// The dataset's Turtle, served at its file IRI. `<#ds>` resolves to NODE against
// the parser's baseIRI (the file), so no rewrite is needed.
const DATASET_TTL = serializeEnergyDataset({
  building: BUILDING,
  year: 2024,
  granularity: "P1Y",
  scenario: "actual",
  metrics: { electricityConsumption: 1234 },
} satisfies EnergyDataset);

/** A fake gateway whose fetch serves DATASET_TTL at FILE and counts its calls. */
function countingGateway(): { gateway: PodGateway; calls: () => number } {
  let count = 0;
  const fetch = ((uri: string | URL) => {
    count++;
    const target = String(uri);
    if (target === FILE) {
      return Promise.resolve(
        new Response(DATASET_TTL, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        }),
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof globalThis.fetch;
  return { gateway: { fetch, webId: WEBID }, calls: () => count };
}

Deno.test("fetchEnergyDatasetShared returns the canonical EnergyDataset", async () => {
  _setAppQueryClient(null);
  const { gateway } = countingGateway();
  const ds = await fetchEnergyDatasetShared(NODE, gateway);
  assert.equal(ds?.building, BUILDING);
  assert.equal(ds?.year, 2024);
  assert.equal(ds?.metrics?.electricityConsumption, 1234);
});

Deno.test("read-once: map + compute share one fetch via the warm cache", async () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    const { gateway, calls } = countingGateway();
    const first = await fetchEnergyDatasetShared(NODE, gateway); // map fold
    const second = await fetchEnergyDatasetShared(NODE, gateway); // aggregation compute
    assert.equal(calls(), 1, "the dataset file is fetched exactly once");
    assert.equal(first?.metrics?.electricityConsumption, 1234);
    assert.equal(second?.metrics?.electricityConsumption, 1234);
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});

Deno.test("headless: no app QueryClient still loads (direct fetch)", async () => {
  _setAppQueryClient(null);
  const { gateway, calls } = countingGateway();
  const ds = await fetchEnergyDatasetShared(NODE, gateway);
  assert.equal(ds?.metrics?.electricityConsumption, 1234);
  assert.equal(calls(), 1);
});

Deno.test("invalidation refetches: a write drops the cached dataset", async () => {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    const { gateway, calls } = countingGateway();
    await fetchEnergyDatasetShared(NODE, gateway);
    assert.equal(calls(), 1);
    // A building/energy mutation invalidates the ["energyDataset"…] prefix.
    await qc.invalidateQueries({ queryKey: energyDatasetKey(WEBID, NODE) });
    await fetchEnergyDatasetShared(NODE, gateway);
    assert.equal(calls(), 2, "the next read after invalidation re-fetches");
  } finally {
    qc.clear();
    _setAppQueryClient(null);
  }
});
