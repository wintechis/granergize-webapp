/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregationType,
  AggregatedViewDefinition,
} from "../../types.ts";
import { computeAggregation } from "./viewComputer.ts";
import { GRAN_NS } from "../utils/vocabularies.ts";
import {
  datasetFileUrl,
  datasetNodeUrl,
  serializeEnergyDataset,
} from "../utils/energyDataset.ts";

const POD = "https://pod.example/granergize/buildings/";
const METRIC = "electricityConsumption";

/** A building file at `<uri>` linking one annual `actual` dataset per given year. */
function buildingDoc(uri: string, years: number[]): string {
  const links = years
    .map((y) => `<${datasetNodeUrl(datasetFileUrl(uri, y, "P1Y", "actual"))}>`)
    .join(" ,\n    ");
  return `@prefix gran: <${GRAN_NS}> .\n<${uri}#b>\n  gran:hasEnergyDataset ${links} .\n`;
}

/**
 * A throwaway pod = { building file → its years×value } served by a fake session.
 * A building referenced by a view but absent here simply 404s (the unreadable case).
 */
function pod(
  buildings: Record<string, { year: number; value: number }[]>,
): Session {
  const docs = new Map<string, string>();
  for (const [uri, datasets] of Object.entries(buildings)) {
    docs.set(uri, buildingDoc(uri, datasets.map((d) => d.year)));
    for (const d of datasets) {
      const file = datasetFileUrl(uri, d.year, "P1Y", "actual");
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

  return {
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
  } as unknown as Session;
}

function def(
  buildingUris: string[],
  aggregationType: AggregationType,
  metrics: string[] = [METRIC],
): AggregatedViewDefinition {
  return {
    id: "v1",
    name: "Test view",
    buildingUris,
    aggregationType,
    metrics,
    createdAt: "2026-06-06T00:00:00Z",
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

Deno.test("computeAggregation: a metric absent from the data is omitted", async () => {
  const session = pod({ [B1]: [{ year: 2024, value: 100 }] });
  const snap = await computeAggregation(
    session,
    def([B1], "average", [METRIC, "heatConsumption"]),
  );
  assert.equal(snap.values[METRIC], 100);
  assert.equal("heatConsumption" in snap.values, false);
});
