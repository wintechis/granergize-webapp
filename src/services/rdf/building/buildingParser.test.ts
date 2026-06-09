/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser } from "n3";
import { parseBuildings } from "./buildingParser.ts";
import { GRAN_NS } from "../vocabularies.ts";

const B = "https://pod.example/granergize/buildings/b1.ttl#b1";
const BASE = "https://pod.example/granergize/buildings/b1";

Deno.test("parseBuildings derives energyDatasets from gran:hasEnergyDataset links", () => {
  const ttl = `@prefix rec: <https://w3id.org/rec#> .
@prefix gran: <${GRAN_NS}> .
<${B}> a rec:Building ;
  gran:hasEnergyDataset <${BASE}/energy/2024-P1Y.ttl#ds> ,
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
