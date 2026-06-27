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

// A faithful slice of an `area/{ags}` document from linked-energieatlas: ONE
// `vocab:AreaPotential` thing carries every merged layer (rooftop, Freiflächen,
// renewable-share + mix, biomass) under the public vocab# namespace, `<#it>`
// relative to the document URI. Wind/geothermal mix shares are a genuine 0.
const AREA_BASE = "https://wunderfacts.com/energieatlas/area/09564000";
const AREA_TTL = `
@prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#it> a vocab:AreaPotential ;
  vocab:name "Nürnberg" ;
  vocab:pvPotentialCapacityMWp 1394.0 ;
  vocab:installedCapacityMWp 131.0 ;
  vocab:remainingPotentialMWp 1264.0 ;
  vocab:developmentDegreePct 9.4 ;
  vocab:groundPvPotentialCapacityMWp 165.0 ;
  vocab:groundPvInstalledCapacityMWp 0.17 ;
  vocab:renewableElectricitySharePct 4.0 ;
  vocab:eeSharePvPct 49.0 ;
  vocab:eeShareBiomassPct 44.1 ;
  vocab:eeShareHydroPct 6.9 ;
  vocab:eeShareWindPct 0.0 ;
  vocab:eeShareGeothermalPct 0.0 ;
  vocab:biogasPotentialElectricKWhPerYear 31605587 ;
  vocab:biomassInstalledCapacityMW 9.1 ;
  vocab:biomassInstallationCount 12 ;
  skos:notation "09564000"^^xsd:token .
`;

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

Deno.test("parseAreaProfile returns null without an AreaPotential thing", () => {
  const ttl = `
@prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
<#it> vocab:name "X" ; vocab:pvPotentialCapacityMWp 10.0 .`;
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
