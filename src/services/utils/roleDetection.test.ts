/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "./rdfHelpers.ts";
import {
  detectBuildingRole,
  detectEnergyShape,
  resolveRole,
} from "./roleDetection.ts";

// Offline fixtures: each role's building/energy graph as Turtle, mirroring the
// shapes in roles.shex. No network/Pod needed.

/** Parse a fixture, resolving relative IRIs against a stable base (as the app
 * does per source). Detection only inspects absolute predicate/type IRIs, but a
 * base keeps the parser unambiguous. */
const g = (ttl: string) => parseRdfText(ttl, "https://ex.test/doc.ttl");

const PREFIXES = `
@prefix rec:      <https://w3id.org/rec#> .
@prefix gran:     <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .
@prefix investor: <https://solid.ti.rw.fau.de/private/granergize/investor-vocab.ttl#> .
@prefix bench:    <https://solid.ti.rw.fau.de/private/granergize/benchmark-vocab.ttl#> .
@prefix uservoc:  <https://solid.ti.rw.fau.de/private/granergize/user-vocab.ttl#> .
@prefix sosa:     <http://www.w3.org/ns/sosa/> .
@prefix time:     <http://www.w3.org/2006/time#> .
@prefix vcard:    <http://www.w3.org/2006/vcard/ns#> .
@prefix geo:      <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix xsd:      <http://www.w3.org/2001/XMLSchema#> .
`;

const DUMMY_BUILDING = `${PREFIXES}
<#building-1> a rec:building ;
  geo:lat 49.5 ; geo:long 11.0 ;
  vcard:locality "Nuremberg" ;
  gran:hasBuildingArea 1200 ;
  gran:hasEnergyMeasurementData [
    gran:measurementYear 2023 ;
    gran:datasetLocation <energy-1.ttl> ;
    gran:type "electricity"
  ] .
`;

// Structurally identical to the dummy building — the role cannot be told apart
// from the building file alone.
const USER_BUILDING = `${PREFIXES}
<#building-2> a rec:building ;
  geo:lat 49.5 ; geo:long 11.0 ;
  gran:hasBuildingArea 800 ;
  gran:hasEnergyConsumptionDataset [
    gran:datasetDate "2024-03-01"^^xsd:date ;
    gran:datasetLocation <readings-2024-03-01.ttl> ;
    gran:type "electricity"
  ] .
`;

const INVESTOR_BUILDING = `${PREFIXES}
<#building-312> a rec:building ;
  geo:lat 50.1 ; geo:long 8.6 ;
  investor:buildingCode "B-312" ;
  investor:hallArea 5400.0 ;
  investor:hasHeatPump true ;
  investor:shiftRegime investor:TwoShift ;
  investor:hasOperatingCosts [ investor:security investor:High ] .
`;

const BENCHMARK_BUILDING = `${PREFIXES}
<#building-9> a rec:building ;
  geo:lat 48.1 ; geo:long 11.6 ;
  bench:companyName "ACME Logistics" ;
  bench:logisticsFunction "distribution" ;
  bench:pvCapacityKW 250.0 ;
  gran:hasEnergyMeasurementData [
    gran:measurementYear 2023 ;
    gran:datasetLocation <energy-9.ttl> ;
    gran:type "electricity"
  ] .
`;

const USER_ENERGY_FILE = `${PREFIXES}
<#r0> a uservoc:EnergyConsumptionReading ;
  sosa:hasResult [ sosa:hasSimpleResult 0.42 ] ;
  sosa:phenomenonTime [ time:hasBeginning "2024-03-01T00:00:00Z"^^xsd:dateTime ] .
`;

const CATEGORICAL_ENERGY_FILE = `${PREFIXES}
<#obs0> a sosa:Observation ;
  sosa:observedProperty gran:electricity ;
  sosa:hasResult [ sosa:hasSimpleResult 12345.0 ] .
`;

Deno.test("detectBuildingRole: investor building → investor (certain)", () => {
  const r = detectBuildingRole(g(INVESTOR_BUILDING));
  assert.deepEqual(r, { role: "investor", certain: true });
});

Deno.test("detectBuildingRole: benchmark building → benchmark (certain)", () => {
  const r = detectBuildingRole(g(BENCHMARK_BUILDING));
  assert.deepEqual(r, { role: "benchmark_service_provider", certain: true });
});

Deno.test("detectBuildingRole: dummy building → dummy (uncertain)", () => {
  const r = detectBuildingRole(g(DUMMY_BUILDING));
  assert.deepEqual(r, { role: "dummy", certain: false });
});

Deno.test("detectBuildingRole: user building is INDISTINGUISHABLE from dummy", () => {
  // The core point from ROLES.md: user and dummy share a building shape.
  const dummy = detectBuildingRole(g(DUMMY_BUILDING));
  const user = detectBuildingRole(g(USER_BUILDING));
  assert.deepEqual(user, dummy);
  assert.equal(user.certain, false);
});

Deno.test("detectEnergyShape: user readings vs categorical observations", () => {
  assert.equal(
    detectEnergyShape(g(USER_ENERGY_FILE)),
    "user-readings",
  );
  assert.equal(
    detectEnergyShape(g(CATEGORICAL_ENERGY_FILE)),
    "categorical-observations",
  );
});

Deno.test("resolveRole: building graph settles investor/benchmark", () => {
  assert.equal(resolveRole(g(INVESTOR_BUILDING)).role, "investor");
  assert.equal(
    resolveRole(g(BENCHMARK_BUILDING)).role,
    "benchmark_service_provider",
  );
});

Deno.test("resolveRole: energy graph disambiguates dummy vs user", () => {
  const userResolved = resolveRole(
    g(USER_BUILDING),
    g(USER_ENERGY_FILE),
  );
  assert.deepEqual(userResolved, { role: "user", certain: true });

  const dummyResolved = resolveRole(
    g(DUMMY_BUILDING),
    g(CATEGORICAL_ENERGY_FILE),
  );
  assert.deepEqual(dummyResolved, { role: "dummy", certain: true });
});

Deno.test("resolveRole: stays uncertain without an energy file", () => {
  const r = resolveRole(g(USER_BUILDING));
  assert.equal(r.certain, false);
  assert.equal(r.role, "dummy");
});

Deno.test("negative: investor building is not misread as benchmark", () => {
  const r = detectBuildingRole(g(INVESTOR_BUILDING));
  assert.notEqual(r.role, "benchmark_service_provider");
});

// Guard the spec artifact: the shapes file must exist and define each role shape
// the detector mirrors. Keeps roles.shex and this detector from drifting apart.
Deno.test("roles.shex defines a shape per role", async () => {
  const shex = await Deno.readTextFile(
    new URL("../../../roles.shex", import.meta.url),
  );
  for (
    const shape of [
      "<BuildingCore>",
      "<DummyBuilding>",
      "<UserBuilding>",
      "<BenchmarkBuilding>",
      "<InvestorBuilding>",
      "<UserReading>",
      "<CategoricalObservation>",
    ]
  ) {
    assert.ok(shex.includes(shape), `roles.shex missing ${shape}`);
  }
});
