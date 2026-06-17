/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  kreisFromInstallations,
  parseNearbyInstallations,
} from "./mastrNearby.ts";

// A faithful slice of a linked-mastr `bbox` listing (Nürnberg): one resource per
// generation unit carrying rdfs:label, WGS84 geo:lat/long, dcterms:spatial →
// …/ags/{8-digit}, and mastr:Energietraeger as a carrier CODE. Mix of renewable
// (solar 2495, wind 2497) and non-renewable (Wärme/combustion 2413, dropped).
const BASE = "https://wunderfacts.com/mastr/bbox";
const FIXTURE = `
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo:     <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr:   <https://wunderfacts.com/mastr/mastr#> .

<https://wunderfacts.com/mastr/see/100#it>
  rdfs:label "PV Roof A" ; geo:lat 49.4540 ; geo:long 11.0780 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2495" .

<https://wunderfacts.com/mastr/see/200#it>
  rdfs:label "Windpark B" ; geo:lat 49.4400 ; geo:long 11.0600 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2497" .

<https://wunderfacts.com/mastr/see/300#it>
  rdfs:label "HKW (Müll)" ; geo:lat 49.4389 ; geo:long 11.0619 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2413" .

<https://wunderfacts.com/mastr/see/400#it>
  rdfs:label "PV Roof Far" ; geo:lat 49.4100 ; geo:long 11.0600 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09563000#it> ;
  mastr:Energietraeger "2495" .
`;

// Query point near unit 100/200 (central Nürnberg).
const LAT = 49.4521, LONG = 11.0767;

Deno.test("parseNearbyInstallations: keeps renewables, drops combustion, sorts by distance", () => {
  const near = parseNearbyInstallations(FIXTURE, BASE, LAT, LONG);
  // The Wärme/combustion unit (2413) is dropped; three renewables remain.
  assert.deepEqual(near.map((u) => u.label), ["PV Roof A", "Windpark B", "PV Roof Far"]);
  assert.deepEqual(near.map((u) => u.kind), ["solar", "wind", "solar"]);
  // Distances increase (sorted).
  assert.ok(near[0].distanceKm < near[1].distanceKm);
  assert.ok(near[1].distanceKm < near[2].distanceKm);
  // The nearest is within a kilometre; carries its IRI + AGS.
  assert.ok(near[0].distanceKm < 1);
  assert.equal(near[0].iri, "https://wunderfacts.com/mastr/see/100#it");
  assert.equal(near[0].ags, "09564000");
});

Deno.test("parseNearbyInstallations: no renewables → empty", () => {
  const onlyCombustion = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo:  <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix mastr:<https://wunderfacts.com/mastr/mastr#> .
<urn:x> rdfs:label "Gas" ; geo:lat 49.4 ; geo:long 11.0 ; mastr:Energietraeger "2413" .`;
  assert.deepEqual(parseNearbyInstallations(onlyCombustion, BASE, LAT, LONG), []);
});

Deno.test("kreisFromInstallations: majority 5-digit prefix wins over a lone border unit", () => {
  const near = parseNearbyInstallations(FIXTURE, BASE, LAT, LONG);
  // Two units in 09564xxx, one in 09563xxx → Kreis 09564.
  assert.equal(kreisFromInstallations(near), "09564");
});

Deno.test("kreisFromInstallations: nothing known → null", () => {
  assert.equal(kreisFromInstallations([]), null);
});
