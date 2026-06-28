/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Building, Energy } from "../../types.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import { _setAppQueryClient } from "../../lib/appQueryClient.ts";
import {
  datasetFileUri,
  type EnergyDataset,
  serializeEnergyDataset,
} from "./energyDataset.ts";
import {
  buildingEnergyKeyFor,
  computeEnergyAverages,
  resolveBuildingEnergy,
  resolveBuildingEnergyByYear,
} from "./buildingEnergy.ts";

const WEBID = "https://pod.example/profile/card#me";
const ROOT = "https://pod.example/granergize/observations/";

function datasetTtl(year: number, electricity: number): string {
  return serializeEnergyDataset({
    building: "https://pod.example/granergize/buildings/b.ttl#it",
    year,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: electricity },
  } satisfies EnergyDataset);
}

/** A gateway whose fetch serves Turtle for the given file IRIs, 404 otherwise. */
function gatewayServing(files: Record<string, string>): PodGateway {
  const fetch = ((uri: string | URL) => {
    const body = files[String(uri)];
    return Promise.resolve(
      body === undefined
        ? new Response("", { status: 404 })
        : new Response(body, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        }),
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, webId: WEBID };
}

function buildingWith(
  refs: Array<{ year: number; id: string }>,
  extra: Partial<Building> = {},
): Building {
  return {
    id: "b",
    uri: "https://pod.example/granergize/buildings/b.ttl#it",
    energyDatasets: refs.map((r) => ({
      uri: `${datasetFileUri(ROOT, r.year, r.id)}#ds`,
      year: r.year,
      granularity: "P1Y",
      scenario: "actual",
    })),
    ...extra,
  } as Building;
}

Deno.test("resolveBuildingEnergy returns the LATEST actual-annual energy", async () => {
  _setAppQueryClient(null);
  const gateway = gatewayServing({
    [datasetFileUri(ROOT, 2023, "a")]: datasetTtl(2023, 100),
    [datasetFileUri(ROOT, 2024, "b")]: datasetTtl(2024, 200),
  });
  const energy = await resolveBuildingEnergy(
    buildingWith([{ year: 2023, id: "a" }, { year: 2024, id: "b" }]),
    gateway,
  );
  assert.equal(energy?.year, 2024);
  assert.equal(energy?.energyNeed.electricityConsumption, 200);
});

Deno.test("resolveBuildingEnergy falls back when the newest year is unreadable", async () => {
  _setAppQueryClient(null);
  // 2024 (newest) is 404 — a per-year share can grant only the older year.
  const gateway = gatewayServing({
    [datasetFileUri(ROOT, 2023, "a")]: datasetTtl(2023, 100),
  });
  const energy = await resolveBuildingEnergy(
    buildingWith([{ year: 2023, id: "a" }, { year: 2024, id: "b" }]),
    gateway,
  );
  assert.equal(energy?.year, 2023);
  assert.equal(energy?.energyNeed.electricityConsumption, 100);
});

Deno.test("resolveBuildingEnergy returns null when no dataset is readable", async () => {
  _setAppQueryClient(null);
  const energy = await resolveBuildingEnergy(
    buildingWith([{ year: 2024, id: "b" }]),
    gatewayServing({}),
  );
  assert.equal(energy, null);
});

Deno.test("resolveBuildingEnergyByYear maps EVERY readable annual year", async () => {
  _setAppQueryClient(null);
  const gateway = gatewayServing({
    [datasetFileUri(ROOT, 2023, "a")]: datasetTtl(2023, 100),
    [datasetFileUri(ROOT, 2024, "b")]: datasetTtl(2024, 200),
  });
  const byYear = await resolveBuildingEnergyByYear(
    buildingWith([{ year: 2023, id: "a" }, { year: 2024, id: "b" }]),
    gateway,
  );
  assert.equal(byYear.size, 2);
  assert.equal(byYear.get(2023)?.electricityConsumption, 100);
  assert.equal(byYear.get(2024)?.electricityConsumption, 200);
});

Deno.test("resolveBuildingEnergyByYear: no readable datasets → empty map", async () => {
  _setAppQueryClient(null);
  const byYear = await resolveBuildingEnergyByYear(
    buildingWith([{ year: 2024, id: "b" }]),
    gatewayServing({}),
  );
  assert.equal(byYear.size, 0);
});

function energyOf(electricity: number): Energy {
  return {
    id: "x",
    uri: "x",
    year: 2024,
    energyNeed: { electricityConsumption: electricity },
    energyGeneration: {},
    energyStorage: {},
    energyDistribution: {},
    energyTransfer: {},
    energyUsage: {},
    environmentalFactor: {},
  };
}

Deno.test("computeEnergyAverages: portfolio is own-only; operator needs ≥2", () => {
  const own1 = { isShared: false, operatedBy: "op1" } as Building;
  const own2 = { isShared: false, operatedBy: "op1" } as Building;
  const shared = { isShared: true, operatedBy: "op1" } as Building;
  const lone = { isShared: false, operatedBy: "op2" } as Building;

  const { portfolioAverages, operatorAverages } = computeEnergyAverages([
    { building: own1, energy: energyOf(100) },
    { building: own2, energy: energyOf(200) },
    { building: shared, energy: energyOf(999) }, // excluded from portfolio
    { building: lone, energy: energyOf(50) }, // lone operator → no operator entry
  ]);

  // Portfolio = mean over OWN only: (100 + 200 + 50) / 3 = 116.67 (shared 999 excluded).
  assert.equal(
    Math.round(portfolioAverages.electricityConsumption),
    117,
  );
  // op1 has 3 contributing buildings (2 own + 1 shared) → published; mean (100+200+999)/3.
  assert.equal(Math.round(operatorAverages.op1.electricityConsumption), 433);
  // op2 has a single building → no entry.
  assert.equal(operatorAverages.op2, undefined);
});

Deno.test("buildingEnergyKeyFor fingerprints the dataset links, sorted", () => {
  const b = buildingWith([{ year: 2024, id: "b" }, { year: 2023, id: "a" }]);
  assert.equal(buildingEnergyKeyFor(b), "2023-P1Y-actual,2024-P1Y-actual");
});
