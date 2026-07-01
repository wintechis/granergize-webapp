/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
import {
  _setSourceGatewayForTesting,
} from "./sourceGateway.ts";
import { makeFakeSourceGateway } from "../testing/fakeSourceGateway.ts";
import {
  eegNumberFromIri,
  fetchInstallationsByAgs,
  kreisFromInstallations,
  parseEegNumber,
  parseNearbyInstallations,
  parseUnitDetail,
} from "./mastrNearby.ts";

/** Parse a fixture to a Store the way the gateway helpers do. */
const store = (ttl: string, base: string) => parseRdfText(ttl, base);

// A faithful slice of a linked-mastr `bbox` listing (Nürnberg): one resource per
// generation unit carrying rdfs:label, WGS84 geo:lat/long, dcterms:spatial →
// …/ags/{8-digit}, and mastr:Energietraeger as a carrier CODE. Mix of renewable
// (solar 2495, wind 2497) and non-renewable (Wärme/combustion 2413, dropped).
const BASE = "https://wunderfacts.com/mastr/within";
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
  const near = parseNearbyInstallations(store(FIXTURE, BASE), LAT, LONG);
  // The Wärme/combustion unit (2413) is dropped; three renewables remain.
  assert.deepEqual(near.map((u) => u.label), ["PV Roof A", "Windpark B", "PV Roof Far"]);
  assert.deepEqual(near.map((u) => u.kind), ["solar", "wind", "solar"]);
  // Distances increase (sorted). The nearby read always sets distanceKm.
  assert.ok(near[0].distanceKm! < near[1].distanceKm!);
  assert.ok(near[1].distanceKm! < near[2].distanceKm!);
  // The nearest is within a kilometre; carries its IRI + AGS.
  assert.ok(near[0].distanceKm! < 1);
  assert.equal(near[0].iri, "https://wunderfacts.com/mastr/see/100#it");
  assert.equal(near[0].ags, "09564000");
});

Deno.test("parseNearbyInstallations: no renewables → empty", () => {
  const onlyCombustion = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo:  <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix mastr:<https://wunderfacts.com/mastr/mastr#> .
<urn:x> rdfs:label "Gas" ; geo:lat 49.4 ; geo:long 11.0 ; mastr:Energietraeger "2413" .`;
  assert.deepEqual(parseNearbyInstallations(store(onlyCombustion, BASE), LAT, LONG), []);
});

Deno.test("kreisFromInstallations: majority 5-digit prefix wins over a lone border unit", () => {
  const near = parseNearbyInstallations(store(FIXTURE, BASE), LAT, LONG);
  // Two units in 09564xxx, one in 09563xxx → Kreis 09564.
  assert.equal(kreisFromInstallations(near), "09564");
});

Deno.test("kreisFromInstallations: nothing known → null", () => {
  assert.equal(kreisFromInstallations([]), null);
});

// ── EEG-number join (the netztransparenz key) ──────────────────────────────────
// A `/see/{id}` unit deref. The renewable unit carries `mastr:EegMaStRNummer` as a
// RELATIVE `../eeg/{number}#it` IRI (resolves to the mastr host); the combustion unit
// omits it. We extract only the number, to build the netztransparenz URL.
const SEE_BASE = "https://wunderfacts.com/mastr/see/900009825478";
const SEE_RENEWABLE = `
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<#it> mastr:Bruttoleistung 156.330 ;
  mastr:EegMaStRNummer <../eeg/934354845027#it> ;
  mastr:Energietraeger <../cl/148#2495> .
`;
const SEE_COMBUSTION = `
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<#it> mastr:Bruttoleistung 26280.000 ;
  mastr:Energietraeger <../cl/133#2413> .
`;

Deno.test("eegNumberFromIri: trailing number from an eeg/{number} IRI", () => {
  assert.equal(
    eegNumberFromIri("https://wunderfacts.com/mastr/eeg/934354845027#it"),
    "934354845027",
  );
  assert.equal(eegNumberFromIri("https://x/see/1#it"), null);
});

Deno.test("parseEegNumber: a renewable unit yields its EEG number", () => {
  assert.equal(parseEegNumber(store(SEE_RENEWABLE, SEE_BASE)), "934354845027");
});

Deno.test("parseEegNumber: a non-EEG (combustion) unit → null", () => {
  assert.equal(parseEegNumber(store(SEE_COMBUSTION, SEE_BASE)), null);
});

Deno.test("parseUnitDetail: master data from a unit /see doc", () => {
  const full = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<#it> rdfs:label "PV Roof X" ;
  mastr:Bruttoleistung 249.750 ;
  mastr:Gemeinde "Nürnberg" ;
  mastr:EegMaStRNummer <../eeg/926794091751#it> ;
  mastr:Energietraeger <../cl/148#2495> .
`;
  const d = parseUnitDetail(store(full, SEE_BASE));
  assert.equal(d.label, "PV Roof X");
  assert.equal(d.capacityKw, 249.75);
  assert.equal(d.kind, "solar"); // carrier 2495, from the catalog IRI fragment
  assert.equal(d.locality, "Nürnberg");
  assert.equal(d.eegNumber, "926794091751");
});

// ── fetchInstallationsByAgs: the /filter region read (gateway-stubbed) ──────────
Deno.test("fetchInstallationsByAgs lists a region's units via /filter (no distance)", async () => {
  // The fake serves the listing as-is for any URL (server-side AGS filtering is
  // the wrapper's job, tested in linked-mastr) — here we assert the fetch→parse.
  const fake = makeFakeSourceGateway({ respond: () => new Response(FIXTURE) });
  _setSourceGatewayForTesting(fake.gateway);
  try {
    const units = await fetchInstallationsByAgs("09564");
    assert.deepEqual(
      units.map((u) => u.label).sort(),
      ["PV Roof A", "PV Roof Far", "Windpark B"],
    );
    assert.equal(units[0].distanceKm, undefined); // region read carries no distance
    assert.ok(
      fake.calls.some((c) => c.url.includes("filter?ags=09564")),
      "requested /filter?ags=",
    );
  } finally {
    _setSourceGatewayForTesting(null);
  }
});
