/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser } from "n3";
import { parseBuildings } from "./buildingParser.ts";
import { CONSUMPTION_NS } from "../vocabularies.ts";

const ROOT = "https://pod.example/";
const B = `${ROOT}granergize/buildings/b1.ttl#it`;
const BASE = `${ROOT}granergize/buildings/b1`;

Deno.test("parseBuildings derives energyDatasets from cons:hasEnergyDataset links", () => {
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
@prefix cons: <${CONSUMPTION_NS}> .
<${B}> a rec:Building ;
  cons:hasEnergyDataset <${BASE}/energy/2024-P1Y.ttl#ds> ,
                        <${BASE}/energy/2023-P1Y-planned.ttl#ds> ,
                        <${BASE}/energy/2024-PT15M.ttl#ds> .
`;
  const buildings = parseBuildings(new Parser().parse(ttl));
  const building = [...buildings.values()][0];
  assert.ok(building, "a building was parsed");

  const ds = building.energyDatasets ?? [];
  assert.equal(ds.length, 3);
  // Self-describing slugs → year/granularity/scenario without a fetch.
  const byGran = Object.fromEntries(ds.map((d) => [`${d.year}-${d.granularity}-${d.scenario}`, d]));
  assert.ok(byGran["2024-P1Y-actual"]);
  assert.ok(byGran["2023-P1Y-planned"]);
  assert.ok(byGran["2024-PT15M-actual"]);
});

Deno.test("parseBuildings: identity is the IRI — relative under own root, absolute foreign", () => {
  const foreign = "https://bob.example/granergize/buildings/x.ttl#it";
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
<${B}> a rec:Building .
<${foreign}> a rec:Building .
`;
  const buildings = parseBuildings(new Parser().parse(ttl), ROOT);
  // Own building: keyed by its storage-root-relative reference, IRI intact.
  const own = buildings.get("granergize/buildings/b1.ttl#it");
  assert.ok(own, "own building keyed by its relative reference");
  assert.equal(own!.uri, B);
  // Foreign building: keyed by its absolute IRI verbatim.
  const shared = buildings.get(foreign);
  assert.ok(shared, "foreign building keyed by its absolute IRI");
  assert.equal(shared!.id, foreign);
});

Deno.test("parseBuildings without a storage root keys everything absolute", () => {
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
<${B}> a rec:Building .
`;
  const buildings = parseBuildings(new Parser().parse(ttl));
  assert.ok(buildings.get(B), "absolute id when no root is given");
});

Deno.test("parseBuildings is type-driven: untyped named nodes are not buildings", () => {
  // A dataset node, an attachment file and a profile node — none typed
  // rec:Building — must not be mistaken for buildings (the old strict-pattern
  // guard's job, now done by the explicit type assertion).
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
@prefix cons: <${CONSUMPTION_NS}> .
<${BASE}/energy/2024-P1Y.ttl#ds> cons:year 2024 .
<${ROOT}granergize/buildings/b1/files/plan.pdf> a <https://schema.org/MediaObject> .
<https://alice.example/profile/card#me> a <http://xmlns.com/foaf/0.1/Person> .
`;
  const buildings = parseBuildings(new Parser().parse(ttl), ROOT);
  assert.equal(buildings.size, 0, "no untyped subject becomes a building");
});

Deno.test("parseBuildings keeps several buildings of ONE foreign document distinct", () => {
  // Legacy/foreign shape: one document, multiple typed buildings with
  // meaningful fragments. Their absolute IRIs keep them distinct — no
  // uniqueness assumption about the fragments themselves.
  const doc = "https://legacy.example/data/buildings.ttl";
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
<${doc}#building-1> a rec:Building .
<${doc}#building-2> a rec:Building .
`;
  const buildings = parseBuildings(new Parser().parse(ttl), ROOT);
  assert.equal(buildings.size, 2);
  assert.ok(buildings.get(`${doc}#building-1`));
  assert.ok(buildings.get(`${doc}#building-2`));
});
