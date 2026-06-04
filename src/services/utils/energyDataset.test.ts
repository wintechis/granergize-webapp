/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import {
  datasetFileUrl,
  datasetNodeUrl,
  datasetSlug,
  type EnergyDataset,
  parseDatasetSlug,
  parseEnergyDataset,
  parseEnergyDatasetRefs,
  serializeEnergyDataset,
} from "./energyDataset.ts";
import { GRAN_NS } from "./vocabularies.ts";

const B = "https://pod.example/granergize/buildings/b-1.ttl#b-1";

function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

Deno.test("datasetSlug / datasetFileUrl encode (year, granularity, scenario)", () => {
  assert.equal(datasetSlug(2024, "P1Y", "actual"), "2024-P1Y");
  assert.equal(datasetSlug(2024, "P1Y", "planned"), "2024-P1Y-planned");
  assert.equal(datasetSlug(2024, "PT15M", "actual"), "2024-PT15M");
  assert.equal(
    datasetFileUrl(B, 2024, "P1Y", "actual"),
    "https://pod.example/granergize/buildings/b-1/energy/2024-P1Y.ttl",
  );
});

Deno.test("parseDatasetSlug round-trips the slug from a link URL", () => {
  const url = datasetNodeUrl(datasetFileUrl(B, 2023, "P1Y", "planned"));
  const ref = parseDatasetSlug(url);
  assert.ok(ref);
  assert.equal(ref!.year, 2023);
  assert.equal(ref!.granularity, "P1Y");
  assert.equal(ref!.scenario, "planned");
  assert.equal(ref!.url, url);

  const series = parseDatasetSlug(
    "https://pod.example/granergize/buildings/b-1/energy/2024-PT15M.ttl#ds",
  );
  assert.equal(series!.granularity, "PT15M");
  assert.equal(series!.scenario, "actual");

  // Not a dataset slug.
  assert.equal(parseDatasetSlug("https://pod.example/x/notes.ttl#x"), null);
});

Deno.test("annual dataset round-trips through serialize → parse", () => {
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: {
      electricityConsumption: 121500,
      heatConsumption: 232000,
      waterConsumption: 1500,
    },
  };
  const ttl = serializeEnergyDataset(ds);
  const store = parse(ttl.replace(/<#ds>/g, `<${datasetNodeUrl(datasetFileUrl(B, 2024, "P1Y", "actual"))}>`));
  const node = datasetNodeUrl(datasetFileUrl(B, 2024, "P1Y", "actual"));
  const back = parseEnergyDataset(store, node);
  assert.ok(back);
  assert.equal(back!.building, B);
  assert.equal(back!.year, 2024);
  assert.equal(back!.granularity, "P1Y");
  assert.equal(back!.scenario, "actual");
  assert.equal(back!.metrics?.electricityConsumption, 121500);
  assert.equal(back!.metrics?.heatConsumption, 232000);
  assert.equal(back!.metrics?.waterConsumption, 1500);
  assert.equal(back!.metrics?.wastewaterConsumption, undefined);

  // It also declares sosa:ObservationCollection (so aggregators can spot it).
  assert.equal(
    store.getQuads(
      node,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      "http://www.w3.org/ns/sosa/ObservationCollection",
      null,
    ).length,
    1,
  );
});

Deno.test("planned scenario serializes gran:Planned and round-trips", () => {
  const ds: EnergyDataset = {
    building: B,
    year: 2025,
    granularity: "P1Y",
    scenario: "planned",
    metrics: { electricityConsumption: 100000 },
  };
  const ttl = serializeEnergyDataset(ds);
  assert.ok(ttl.includes("gran:scenario gran:Planned"));
  const node = "https://x/ds#ds";
  const store = parse(ttl.replace(/<#ds>/g, `<${node}>`));
  assert.equal(parseEnergyDataset(store, node)!.scenario, "planned");
});

Deno.test("series descriptor round-trips (located, no inline observations)", () => {
  const loc = "https://pod.example/granergize/buildings/b-1/energy/2024-PT15M/";
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "PT15M",
    scenario: "actual",
    datasetLocation: loc,
  };
  const ttl = serializeEnergyDataset(ds);
  const node = "https://x/s#ds";
  const store = parse(ttl.replace(/<#ds>/g, `<${node}>`));
  const back = parseEnergyDataset(store, node);
  assert.ok(back);
  assert.equal(back!.granularity, "PT15M");
  assert.equal(back!.datasetLocation, loc);
  assert.equal(back!.metrics, undefined);
});

Deno.test("parseEnergyDatasetRefs reads the building's hasEnergyDataset links", () => {
  const a = datasetNodeUrl(datasetFileUrl(B, 2024, "P1Y", "actual"));
  const b = datasetNodeUrl(datasetFileUrl(B, 2024, "PT15M", "actual"));
  const store = parse(
    `@prefix gran: <${GRAN_NS}> .\n<${B}> gran:hasEnergyDataset <${a}>, <${b}> .\n`,
  );
  const refs = parseEnergyDatasetRefs(store, B);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.granularity).sort(), ["P1Y", "PT15M"]);
});
