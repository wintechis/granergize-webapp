/// <reference lib="deno.ns" />
import { sessionGateway } from "../pod/podGateway.ts";
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  datasetFileUri,
  datasetNodeUri,
  type EnergyDataset,
  type EnergyDatasetRef,
  findDatasetLink,
  listSeriesDays,
  loadEnergyDatasets,
  observationsRootForBuilding,
  parseDatasetLink,
  parseEnergyDataset,
  parseEnergyDatasetRefs,
  seriesContainerUri,
  seriesDailyFileUri,
  serializeEnergyDataset,
} from "./energyDataset.ts";
import { CONSUMPTION_NS, SOSA_NS, UNIT_NS } from "../rdf/vocabularies.ts";
import {
  clearDatasetRegistry,
  getGraphQuads,
} from "../rdf/datasetRegistry.ts";

const B = "https://pod.example/granergize/buildings/b-1.ttl#it";
const ROOT = "https://pod.example/granergize/observations/";
const ID = "abc";

function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

// A foreign dataset whose energy is stored in a NON-canonical unit (MWh): serialize a
// canonical (kWh) dataset, then swap the unit IRI to simulate it.
Deno.test("parseEnergyDataset normalises a non-canonical unit (MWh → kWh) + records it", () => {
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 5 },
  };
  const ttl = serializeEnergyDataset(ds)
    .replace(/<#ds>/g, `<${node}>`)
    .replace("KiloW-HR", "MegaW-HR"); // the stored value 5 now means 5 MWh
  const back = parseEnergyDataset(parse(ttl), node);
  assert.equal(back!.metrics!.electricityConsumption, 5000); // 5 MWh → 5000 kWh (canonical)
  assert.equal(back!.units!.electricityConsumption, `${UNIT_NS}MegaW-HR`);
});

Deno.test("parseEnergyDataset skips an unrecognised unit (no silently-wrong number)", () => {
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 5 },
  };
  const ttl = serializeEnergyDataset(ds)
    .replace(/<#ds>/g, `<${node}>`)
    .replace("KiloW-HR", "BTU");
  const back = parseEnergyDataset(parse(ttl), node);
  assert.equal(back!.metrics!.electricityConsumption, undefined); // skipped, not a wrong 5
  assert.equal(back!.units, undefined);
});

Deno.test("observationsRootForBuilding derives the sibling observations/ root", () => {
  assert.equal(observationsRootForBuilding(B), ROOT);
  assert.equal(
    observationsRootForBuilding("https://pod.example/granergize/buildings/x.ttl"),
    ROOT,
  );
});

Deno.test("datasetFileUri / seriesDailyFileUri build time-first paths", () => {
  assert.equal(datasetFileUri(ROOT, 2024, ID), `${ROOT}2024/${ID}.ttl`);
  assert.equal(seriesContainerUri(ROOT, 2024), `${ROOT}2024/`);
  assert.equal(
    seriesDailyFileUri(ROOT, "2024-03-15", ID),
    `${ROOT}2024/03/15/${ID}.ttl`,
  );
});

Deno.test("parseDatasetLink reads year from the path, granularity/scenario from the store", () => {
  const uri = `${datasetFileUri(ROOT, 2023, ID)}#ds`;
  const store = parse(
    `@prefix cons: <${CONSUMPTION_NS}> .\n` +
      `<${uri}> cons:granularity "P1Y" ; cons:scenario cons:Planned .\n`,
  );
  const ref = parseDatasetLink(uri, store);
  assert.ok(ref);
  assert.equal(ref!.year, 2023);
  assert.equal(ref!.granularity, "P1Y");
  assert.equal(ref!.scenario, "planned");
  assert.equal(ref!.uri, uri);

  // No store → year from path, granularity/scenario default to P1Y/actual.
  const bare = parseDatasetLink(`${datasetFileUri(ROOT, 2024, ID)}#ds`);
  assert.equal(bare!.year, 2024);
  assert.equal(bare!.granularity, "P1Y");
  assert.equal(bare!.scenario, "actual");

  // Not an observation IRI.
  assert.equal(parseDatasetLink("https://pod.example/x/notes.ttl#x"), null);
});

Deno.test("findDatasetLink matches an existing link by (year, granularity, scenario)", () => {
  const a = `${datasetFileUri(ROOT, 2024, "id-a")}#ds`;
  const b = `${datasetFileUri(ROOT, 2024, "id-b")}#ds`;
  const store = parse(
    `@prefix cons: <${CONSUMPTION_NS}> .\n` +
      `<${B}> cons:hasEnergyDataset <${a}>, <${b}> .\n` +
      `<${a}> cons:granularity "P1Y" ; cons:scenario cons:Actual .\n` +
      `<${b}> cons:granularity "PT15M" ; cons:scenario cons:Actual .\n`,
  );
  assert.equal(findDatasetLink(store, B, 2024, "P1Y", "actual"), a);
  assert.equal(findDatasetLink(store, B, 2024, "PT15M", "actual"), b);
  assert.equal(findDatasetLink(store, B, 2024, "P1Y", "planned"), null);
  assert.equal(findDatasetLink(store, B, 2025, "P1Y", "actual"), null);
});

Deno.test("findDatasetLink keeps a per-unit (featureOfInterest) dataset distinct from the building's", () => {
  const file = B.split("#")[0];
  const pv = `${file}#pv`;
  const battery = `${file}#battery`;
  const whole = `${datasetFileUri(ROOT, 2024, "id-whole")}#ds`;
  const unit = `${datasetFileUri(ROOT, 2024, "id-pv")}#ds`;
  // Two datasets for the SAME (year, granularity, scenario) — one building-wide,
  // one observing the <#pv> unit. Per-unit observations must not collide with the
  // building's (or saving the PV's 2024 would overwrite the building's 2024).
  const store = parse(
    `@prefix cons: <${CONSUMPTION_NS}> .\n` +
      `@prefix sosa: <${SOSA_NS}> .\n` +
      `<${B}> cons:hasEnergyDataset <${whole}>, <${unit}> .\n` +
      `<${whole}> cons:granularity "P1Y" ; cons:scenario cons:Actual .\n` +
      `<${unit}> cons:granularity "P1Y" ; cons:scenario cons:Actual ;\n` +
      `   sosa:hasFeatureOfInterest <${pv}> .\n`,
  );
  assert.equal(findDatasetLink(store, B, 2024, "P1Y", "actual"), whole); // building (no FoI)
  assert.equal(findDatasetLink(store, B, 2024, "P1Y", "actual", pv), unit); // the PV unit
  // A FoI with no dataset doesn't fall back to the building's.
  assert.equal(findDatasetLink(store, B, 2024, "P1Y", "actual", battery), null);
  // parseDatasetLink surfaces the FoI on the ref.
  assert.equal(parseDatasetLink(unit, store)!.featureOfInterest, pv);
  assert.equal(parseDatasetLink(whole, store)!.featureOfInterest, undefined);
});

Deno.test("featureOfInterest round-trips through serialize → parse", () => {
  const pv = `${B.split("#")[0]}#pv`;
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityGeneration: 240000 },
    featureOfInterest: pv,
  };
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const store = parse(serializeEnergyDataset(ds).replace(/<#ds>/g, `<${node}>`));
  const back = parseEnergyDataset(store, node);
  assert.ok(back);
  assert.equal(back!.featureOfInterest, pv);
  assert.equal(back!.metrics?.electricityGeneration, 240000);
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
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const ttl = serializeEnergyDataset(ds);
  const store = parse(ttl.replace(/<#ds>/g, `<${node}>`));
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

Deno.test("building-less observation: omits cons:ofBuilding, round-trips with building=''", () => {
  // An unbound observation (no building yet — to be linked later) must NOT emit
  // `cons:ofBuilding <>` (an empty IRI is invalid Turtle); the parser reads it back as "".
  const ds: EnergyDataset = {
    building: "",
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 5000 },
  };
  const ttl = serializeEnergyDataset(ds);
  assert.equal(/cons:ofBuilding/.test(ttl), false, "no ofBuilding triple when unbound");
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const back = parseEnergyDataset(parse(ttl.replace(/<#ds>/g, `<${node}>`)), node);
  assert.ok(back);
  assert.equal(back!.building, "");
  assert.equal(back!.metrics?.electricityConsumption, 5000);
});

Deno.test("featureOfInterest emits sosa:hasFeatureOfInterest on the dataset node", () => {
  // Generation observations are about the building's <#pv> plant, not the building.
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "planned",
    metrics: { electricityGeneration: 240000 },
    featureOfInterest: "../../buildings/x.ttl#pv",
  };
  const node = `${datasetFileUri(ROOT, 2024, ID)}#ds`;
  const ttl = serializeEnergyDataset(ds);
  const store = parse(
    ttl.replace(/<#ds>/g, `<${node}>`)
      .replace("<../../buildings/x.ttl#pv>", `<${ROOT}buildings/x.ttl#pv>`),
  );
  assert.equal(
    store.getQuads(
      node,
      "http://www.w3.org/ns/sosa/hasFeatureOfInterest",
      `${ROOT}buildings/x.ttl#pv`,
      null,
    ).length,
    1,
  );
  // Without it, no such triple is emitted.
  const plain = parse(
    serializeEnergyDataset({ ...ds, featureOfInterest: undefined })
      .replace(/<#ds>/g, `<${node}>`),
  );
  assert.equal(
    plain.getQuads(node, "http://www.w3.org/ns/sosa/hasFeatureOfInterest", null, null)
      .length,
    0,
  );
});

Deno.test("planned scenario serializes cons:Planned and round-trips", () => {
  const ds: EnergyDataset = {
    building: B,
    year: 2025,
    granularity: "P1Y",
    scenario: "planned",
    metrics: { electricityConsumption: 100000 },
  };
  const ttl = serializeEnergyDataset(ds);
  assert.ok(ttl.includes("cons:scenario cons:Planned"));
  const node = "https://x/ds#ds";
  const store = parse(ttl.replace(/<#ds>/g, `<${node}>`));
  assert.equal(parseEnergyDataset(store, node)!.scenario, "planned");
});

Deno.test("series descriptor round-trips (located, no inline observations)", () => {
  const loc = seriesContainerUri(ROOT, 2024);
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

Deno.test("loadEnergyDatasets fetches a ref and returns its stored metrics", async () => {
  // This is the read path the energy-year edit form relies on: re-opening a
  // stored year must surface its full figures so an edit doesn't drop the
  // untouched ones (#5 data loss).
  const fileUri = datasetFileUri(ROOT, 2024, ID);
  const ref: EnergyDatasetRef = {
    uri: datasetNodeUri(fileUri),
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
  };
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 121500, waterConsumption: 1500 },
  };
  const ttl = serializeEnergyDataset(ds); // emits a relative <#ds> node
  const fetchFn = (uri: string): Promise<Response> => {
    assert.equal(uri, fileUri); // ref's #fragment stripped before the GET
    return Promise.resolve(
      new Response(ttl, { headers: { "Content-Type": "text/turtle" } }),
    );
  };

  const [back] = await loadEnergyDatasets([ref], fetchFn);
  assert.ok(back);
  assert.equal(back.metrics?.electricityConsumption, 121500);
  assert.equal(back.metrics?.waterConsumption, 1500);
  assert.equal(back.metrics?.heatConsumption, undefined);
});

Deno.test("loadEnergyDataset feeds the dataset registry (graph = document IRI)", async () => {
  clearDatasetRegistry();
  const fileUri = datasetFileUri(ROOT, 2024, ID);
  const ref: EnergyDatasetRef = {
    uri: datasetNodeUri(fileUri),
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
  };
  const ds: EnergyDataset = {
    building: B,
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 121500 },
  };
  const ttl = serializeEnergyDataset(ds);
  const fetchFn = () =>
    Promise.resolve(
      new Response(ttl, { headers: { "Content-Type": "text/turtle" } }),
    );
  await loadEnergyDatasets([ref], fetchFn);
  assert.ok(
    getGraphQuads(fileUri)?.length,
    "the dataset document's graph is recorded under its file IRI",
  );
  clearDatasetRegistry();
});

Deno.test("loadEnergyDatasets skips an unreadable ref without throwing", async () => {
  const ref: EnergyDatasetRef = {
    uri: datasetNodeUri(datasetFileUri(ROOT, 2024, ID)),
    year: 2024,
    granularity: "P1Y",
    scenario: "actual",
  };
  const fetchFn = (): Promise<Response> =>
    Promise.resolve(new Response("Forbidden", { status: 403 }));
  assert.deepEqual(await loadEnergyDatasets([ref], fetchFn), []);
});

Deno.test("parseEnergyDatasetRefs reads the building's hasEnergyDataset links + descriptors", () => {
  const a = datasetNodeUri(datasetFileUri(ROOT, 2024, "id-a"));
  const b = datasetNodeUri(datasetFileUri(ROOT, 2024, "id-b"));
  const store = parse(
    `@prefix cons: <${CONSUMPTION_NS}> .\n` +
      `<${B}> cons:hasEnergyDataset <${a}>, <${b}> .\n` +
      `<${a}> cons:granularity "P1Y" ; cons:scenario cons:Actual .\n` +
      `<${b}> cons:granularity "PT15M" ; cons:scenario cons:Actual .\n`,
  );
  const refs = parseEnergyDatasetRefs(store, B);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.granularity).sort(), ["P1Y", "PT15M"]);
});

Deno.test("listSeriesDays walks the year's month/day containers for the dataset's id", async () => {
  const ref: EnergyDatasetRef = {
    uri: datasetNodeUri(datasetFileUri(ROOT, 2024, ID)),
    year: 2024,
    granularity: "PT15M",
    scenario: "actual",
  };
  const yearC = `${ROOT}2024/`;
  const monthC = `${yearC}01/`;
  const day1 = `${monthC}01/`;
  const day2 = `${monthC}02/`;
  const ldp = (container: string, children: string[]): Response => {
    const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${container}> ldp:contains ${
      children.map((c) => `<${c}>`).join(", ")
    } .\n`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/turtle" },
    });
  };
  const fetch = (input: string | URL): Promise<Response> => {
    const u = String(input);
    if (u === yearC) return Promise.resolve(ldp(yearC, [monthC]));
    if (u === monthC) return Promise.resolve(ldp(monthC, [day1, day2]));
    if (u === day1) {
      return Promise.resolve(ldp(day1, [`${day1}${ID}.ttl`, `${day1}other.ttl`]));
    }
    if (u === day2) return Promise.resolve(ldp(day2, [`${day2}${ID}.ttl`]));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const session = sessionGateway({ info: { webId: "x", isLoggedIn: true }, fetch } as unknown as Session);
  const days = await listSeriesDays(session, ref);
  assert.deepEqual(days, [
    { day: "2024-01-01", uri: `${day1}${ID}.ttl` },
    { day: "2024-01-02", uri: `${day2}${ID}.ttl` },
  ]);
});
