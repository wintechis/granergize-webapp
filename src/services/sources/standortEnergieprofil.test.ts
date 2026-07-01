/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
const store = (ttl: string, base: string) => parseRdfText(ttl, base);
import { areaUrl, parseAreaProfile } from "./standortEnergieprofil.ts";
import { gemeindeFromInstallations, type NearbyInstallation } from "./mastrNearby.ts";

// The URL builder backs BOTH the fetch and the Developer-mode source link, which
// must be an ABSOLUTE, dereferenceable wrapper IRI.
Deno.test("areaUrl builds an absolute wrapper IRI", () => {
  assert.match(areaUrl("09564000"), /^https:\/\/[^/]+\/energieatlas\/area\/09564000$/);
});

// A faithful slice of an `area/{ags}` RDF Data Cube document from linked-energieatlas:
// one `qb:Observation` per indicator (the metric on a `#dim-indicator` dimension, the
// value on `#measure-OBS_VALUE`), plus the region descriptor carrying the Gemeinde name
// (rdfs:label). IRIs are relative to the document URI, as the wrapper serves them.
// Wind/geothermal mix shares are a genuine 0.
const AREA_BASE = "https://wunderfacts.com/energieatlas/area/09564000";
const AREA_INDICATORS: ReadonlyArray<[string, number]> = [
  ["pvPotentialCapacityMWp", 1394.0],
  ["installedCapacityMWp", 131.0],
  ["remainingPotentialMWp", 1264.0],
  ["developmentDegreePct", 9.4],
  ["groundPvPotentialCapacityMWp", 165.0],
  ["groundPvInstalledCapacityMWp", 0.17],
  ["renewableElectricitySharePct", 4.0],
  ["eeSharePvPct", 49.0],
  ["eeShareBiomassPct", 44.1],
  ["eeShareHydroPct", 6.9],
  ["eeShareWindPct", 0.0],
  ["eeShareGeothermalPct", 0.0],
  ["biogasPotentialElectricKWhPerYear", 31605587],
  ["biomassInstalledCapacityMW", 9.1],
  ["biomassInstallationCount", 12],
];
const AREA_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<../ags/09564000> rdfs:label "Nürnberg" .
` +
  AREA_INDICATORS.map(([k, v]) =>
    `<#obs-${k}> a qb:Observation ;
  <../ds/area#dim-geo> <../ags/09564000> ;
  <../ds/area#dim-TIME_PERIOD> "2024"^^xsd:gYear ;
  <../ds/area#dim-indicator> <../cl/indicator#${k}> ;
  <../ds/area#measure-OBS_VALUE> ${v} .`
  ).join("\n");

Deno.test("parseAreaProfile assembles every served card", () => {
  const p = parseAreaProfile(store(AREA_TTL, AREA_BASE));
  assert.ok(p);
  assert.equal(p!.name, "Nürnberg");

  // Rooftop — pre-computed headroom/degree kept verbatim.
  assert.equal(p!.rooftop?.potentialMWp, 1394);
  assert.equal(p!.rooftop?.remainingMWp, 1264);
  assert.equal(p!.rooftop?.degreePct, 9.4);

  // Freiflächen — headroom/degree DERIVED (the layer has no pre-computed pair).
  assert.equal(p!.ground?.potentialMWp, 165);
  assert.equal(p!.ground?.installedMWp, 0.17);
  assert.ok(Math.abs((p!.ground?.remainingMWp ?? 0) - 164.83) < 1e-6);

  // Green electricity — share + the carrier mix, zero carriers dropped, desc.
  assert.equal(p!.green?.renewableSharePct, 4);
  assert.deepEqual(p!.green?.mix.map((e) => e.carrier), ["solar", "biomass", "hydro"]);
  assert.equal(p!.green?.mix[0].sharePct, 49);

  // Biomass — biogas kWh → GWh, installed, plant count.
  assert.ok(Math.abs((p!.biomass?.biogasPotentialGWh ?? 0) - 31.605587) < 1e-6);
  assert.equal(p!.biomass?.installedMW, 9.1);
  assert.equal(p!.biomass?.plantCount, 12);
});

Deno.test("parseAreaProfile returns null without observations", () => {
  const ttl = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<../ags/09564000> rdfs:label "X" .`;
  assert.equal(parseAreaProfile(store(ttl, AREA_BASE)), null);
});

Deno.test("gemeindeFromInstallations picks the most frequent 8-digit AGS", () => {
  const u = (ags: string): NearbyInstallation => ({
    iri: "x", label: "x", kind: "solar", lat: 0, long: 0, ags, distanceKm: 0,
  });
  assert.equal(
    gemeindeFromInstallations([u("09564000"), u("09564000"), u("09572139")]),
    "09564000",
  );
  assert.equal(gemeindeFromInstallations([]), null);
  assert.equal(gemeindeFromInstallations([u("09564")]), null); // Kreis-only ignored
});
