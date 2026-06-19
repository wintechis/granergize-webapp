/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../pod/podGateway.ts";
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregationType,
  AggregationDefinition,
} from "../../types.ts";
import { QueryClient } from "@tanstack/react-query";
import {
  computeAggregation,
  resolveSpatialExtent,
  summarizeContributors,
} from "./aggregationComputer.ts";
import { CONSUMPTION_NS } from "../rdf/vocabularies.ts";
import {
  datasetFileUri,
  datasetNodeUri,
  observationsRootForBuilding,
  serializeEnergyDataset,
} from "../rdf/energyDataset.ts";
import { _setAppQueryClient } from "../../lib/appQueryClient.ts";

const POD = "https://pod.example/granergize/buildings/";
const METRIC = "electricityConsumption";

/** Deterministic dataset id for a building × year (so tests can address it). */
const dsId = (uri: string, year: number): string =>
  `${uri.split("/").pop()!.replace(/\.ttl$/, "")}-${year}`;

/** The (time-first) annual dataset file IRI for a building × year. */
const annualFile = (uri: string, year: number): string =>
  datasetFileUri(observationsRootForBuilding(uri), year, dsId(uri, year));

/** A building file at `<uri>` linking one annual `actual` dataset per given year. */
function buildingDoc(uri: string, years: number[]): string {
  const lines = years.map((y) => {
    const node = datasetNodeUri(annualFile(uri, y));
    return `<${uri}#b> cons:hasEnergyDataset <${node}> .\n` +
      `<${node}> cons:granularity "P1Y" ; cons:scenario cons:Actual .\n`;
  });
  return `@prefix cons: <${CONSUMPTION_NS}> .\n${lines.join("")}`;
}

/**
 * A throwaway pod = { building file → its years×value } served by a fake session.
 * A building referenced by an aggregation but absent here simply 404s (the unreadable case).
 */
function pod(
  buildings: Record<string, { year: number; value: number }[]>,
): PodGateway {
  const docs = new Map<string, string>();
  for (const [uri, datasets] of Object.entries(buildings)) {
    docs.set(uri, buildingDoc(uri, datasets.map((d) => d.year)));
    for (const d of datasets) {
      const file = annualFile(uri, d.year);
      docs.set(
        file,
        serializeEnergyDataset({
          building: `${uri}#b`,
          year: d.year,
          granularity: "P1Y",
          scenario: "actual",
          metrics: { [METRIC]: d.value },
        }),
      );
    }
  }

  return sessionGateway({
    info: { isLoggedIn: true, webId: "https://me.example/profile/card#me" },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      const body = docs.get(url);
      if (body === undefined) {
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    },
  } as unknown as Session);
}

function def(
  buildingUris: string[],
  aggregationType: AggregationType,
  metrics: string[] = [METRIC],
  benchmark?: boolean,
): AggregationDefinition {
  return {
    id: "v1",
    name: "Test aggregation",
    buildingUris,
    aggregationType,
    metrics,
    createdAt: "2026-06-06T00:00:00Z",
    ...(benchmark ? { benchmark } : {}),
  };
}

const B1 = `${POD}b1.ttl`;
const B2 = `${POD}b2.ttl`;
const B3 = `${POD}b3.ttl`;

Deno.test("computeAggregation: average over three buildings", async () => {
  const session = pod({
    [B1]: [{ year: 2024, value: 100 }],
    [B2]: [{ year: 2024, value: 200 }],
    [B3]: [{ year: 2024, value: 300 }],
  });
  const snap = await computeAggregation(session, def([B1, B2, B3], "average"));
  assert.equal(snap.values[METRIC], 200);
  assert.equal(snap.buildingCount, 3);
  assert.deepEqual(snap.metrics, [METRIC]);
});

Deno.test("computeAggregation: sum / min / max over the same data", async () => {
  const data = {
    [B1]: [{ year: 2024, value: 100 }],
    [B2]: [{ year: 2024, value: 200 }],
    [B3]: [{ year: 2024, value: 300 }],
  };
  const cases: [AggregationType, number][] = [
    ["sum", 600],
    ["min", 100],
    ["max", 300],
  ];
  for (const [type, expected] of cases) {
    const snap = await computeAggregation(pod(data), def([B1, B2, B3], type));
    assert.equal(snap.values[METRIC], expected, type);
  }
});

Deno.test("computeAggregation: uses the latest annual year per building", async () => {
  // B1 has 2023=50 and 2024=100 → the 2024 value wins; averaged with B2's 200.
  const session = pod({
    [B1]: [{ year: 2023, value: 50 }, { year: 2024, value: 100 }],
    [B2]: [{ year: 2024, value: 200 }],
  });
  const snap = await computeAggregation(session, def([B1, B2], "average"));
  assert.equal(snap.values[METRIC], 150);
  assert.equal(snap.buildingCount, 2);
});

Deno.test("computeAggregation: an unreadable building is skipped, not counted", async () => {
  // B2 is absent from the pod (its file 404s); only B1 and B3 contribute.
  const session = pod({
    [B1]: [{ year: 2024, value: 100 }],
    [B3]: [{ year: 2024, value: 300 }],
  });
  const snap = await computeAggregation(session, def([B1, B2, B3], "average"));
  assert.equal(snap.values[METRIC], 200); // mean(100, 300)
  assert.equal(snap.buildingCount, 2);
});

Deno.test("computeAggregation: no readable buildings yields empty values", async () => {
  const session = pod({});
  const snap = await computeAggregation(session, def([B1], "average"));
  assert.deepEqual(snap.values, {});
  assert.equal(snap.buildingCount, 0);
});

Deno.test("computeAggregation: takes the building's dataset refs from the warm cache, not a file re-read", async () => {
  // The building FILE 404s (the slow-Pod re-read flake), but its dataset file is
  // served. With the building's refs in the warm `useBuildings` cache, the compute
  // must still find them and aggregate — proving it no longer depends on re-reading
  // the building file. Without the cache it returns null (the empty-snapshot bug).
  const WEBID = "https://me.example/profile/card#me";
  const subject = `${B1}#b`;
  const dsFile = annualFile(B1, 2024);
  const session = sessionGateway({
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (url === dsFile) {
        return Promise.resolve(
          new Response(
            serializeEnergyDataset({
              building: subject,
              year: 2024,
              granularity: "P1Y",
              scenario: "actual",
              metrics: { [METRIC]: 500 },
            }),
            { status: 200, headers: { "Content-Type": "text/turtle" } },
          ),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["buildings", WEBID], {
    buildings: [{
      uri: subject,
      energyDatasets: [{
        uri: datasetNodeUri(dsFile),
        year: 2024,
        granularity: "P1Y",
        scenario: "actual",
      }],
    }],
  });
  _setAppQueryClient(qc);
  try {
    const snap = await computeAggregation(session, def([subject], "average"));
    assert.equal(snap.buildingCount, 1, "ref came from the cache, file 404 ignored");
    assert.equal(snap.values[METRIC], 500);
  } finally {
    _setAppQueryClient(null);
  }
});

Deno.test("computeAggregation: a metric absent from the data is omitted", async () => {
  const session = pod({ [B1]: [{ year: 2024, value: 100 }] });
  const snap = await computeAggregation(
    session,
    def([B1], "average", [METRIC, "heatConsumption"]),
  );
  assert.equal(snap.values[METRIC], 100);
  assert.equal("heatConsumption" in snap.values, false);
});

Deno.test("resolveSpatialExtent: folds members to their finest shared region", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["buildings", "me"], {
    buildings: [
      { uri: B1, lat: 49.45, long: 11.07 },
      { uri: B2, lat: 49.46, long: 11.08 },
    ],
  });
  _setAppQueryClient(qc);
  try {
    // Both in the same Gemeinde → Gemeinde grain.
    const gem = await resolveSpatialExtent([B1, B2], () => Promise.resolve("09564000"));
    assert.equal(gem?.level, "gemeinde");
    assert.ok(gem?.region.endsWith("/ags/09564000"));

    // Different Gemeinde, same Kreis → Kreis (resolver keyed by latitude).
    const byLat = (lat: number) =>
      Promise.resolve(lat === 49.45 ? "09564000" : "09564001");
    assert.equal((await resolveSpatialExtent([B1, B2], byLat))?.level, "kreis");

    // One member outside the layer (null) → all-or-nothing → no region.
    const partial = await resolveSpatialExtent(
      [B1, B2],
      (lat) => Promise.resolve(lat === 49.45 ? "09564000" : null),
    );
    assert.equal(partial, undefined);
  } finally {
    _setAppQueryClient(null);
  }
});

Deno.test("resolveSpatialExtent: a building without coordinates → no region, no lookup", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["buildings", "me"], { buildings: [{ uri: B1 }] }); // no lat/long
  _setAppQueryClient(qc);
  try {
    let called = false;
    const r = await resolveSpatialExtent([B1], () => {
      called = true;
      return Promise.resolve("09564000");
    });
    assert.equal(r, undefined);
    assert.equal(called, false, "no lookup fires for a building without coordinates");
  } finally {
    _setAppQueryClient(null);
  }
});

Deno.test("resolveSpatialExtent: empty set → undefined (no lookup)", async () => {
  assert.equal(await resolveSpatialExtent([]), undefined);
});

Deno.test("computeAggregation: a benchmark-flagged DEFINITION marks the snapshot (typing survives any recompute)", async () => {
  // The flag lives on the definition, so a plain refresh re-derives the
  // bench:BenchmarkResult typing — call-site options used to be the only
  // carrier, and a refresh (which passed none) silently stripped it.
  const session = pod({ [B1]: [{ year: 2024, value: 100 }] });
  const snap = await computeAggregation(session, def([B1], "average", [METRIC], true));
  assert.equal(snap.isBenchmark, true);
  assert.equal(snap.computedBy, "https://me.example/profile/card#me");
  // metricPeriod is DERIVED from the data actually aggregated (latest year).
  assert.equal(snap.metricPeriod, "2024");
});

Deno.test("computeAggregation: benchmark metricPeriod tracks the newest year across buildings", async () => {
  const session = pod({
    [B1]: [{ year: 2023, value: 50 }, { year: 2024, value: 100 }],
    [B2]: [{ year: 2023, value: 200 }],
  });
  const snap = await computeAggregation(session, def([B1, B2], "average", [METRIC], true));
  assert.equal(snap.metricPeriod, "2024");
});

Deno.test("computeAggregation: without the definition flag the snapshot is unmarked", async () => {
  const session = pod({ [B1]: [{ year: 2024, value: 100 }] });
  const snap = await computeAggregation(session, def([B1], "average"));
  assert.equal(snap.isBenchmark, undefined);
  assert.equal(snap.computedBy, undefined);
  assert.equal(snap.metricPeriod, undefined);
});

Deno.test("summarizeContributors collects the building roster + distinct sharers", () => {
  const { buildingUris, contributors } = summarizeContributors([
    { buildingUri: `${POD}1.ttl`, sharedBy: "https://alice.pod/profile/card#me" },
    { buildingUri: `${POD}7.ttl`, sharedBy: "https://bob.pod/profile/card#me" },
  ]);
  assert.deepEqual(buildingUris, [`${POD}1.ttl`, `${POD}7.ttl`]);
  assert.deepEqual(contributors, [
    "https://alice.pod/profile/card#me",
    "https://bob.pod/profile/card#me",
  ]);
});

Deno.test("summarizeContributors de-duplicates buildings and sharers", () => {
  const { buildingUris, contributors } = summarizeContributors([
    { buildingUri: `${POD}1.ttl`, sharedBy: "https://alice.pod/profile/card#me" },
    { buildingUri: `${POD}2.ttl`, sharedBy: "https://alice.pod/profile/card#me" },
    { buildingUri: `${POD}1.ttl`, sharedBy: "https://alice.pod/profile/card#me" },
  ]);
  assert.equal(buildingUris.length, 2);
  assert.deepEqual(contributors, ["https://alice.pod/profile/card#me"]);
});

Deno.test("summarizeContributors drops Unknown sharers but keeps their building", () => {
  const { buildingUris, contributors } = summarizeContributors([
    { buildingUri: `${POD}9.ttl`, sharedBy: "Unknown" },
    { buildingUri: `${POD}7.ttl`, sharedBy: "https://bob.pod/profile/card#me" },
  ]);
  assert.equal(buildingUris.length, 2);
  assert.deepEqual(contributors, ["https://bob.pod/profile/card#me"]);
});
