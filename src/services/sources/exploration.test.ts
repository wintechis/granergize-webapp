/// <reference lib="deno.ns" />
// The keystone of the SourceGateway work: the end-to-end exploration chain
// "type a place name → resolve its region → list the region's units" runs fully
// in-process over a single fake gateway serving the linked-lau /search and the
// linked-mastr /filter responses. Proves the two wrapper capabilities and the
// gateway wiring compose without touching the network.
import { strict as assert } from "node:assert";
import { _setSourceGatewayForTesting } from "./sourceGateway.ts";
import { makeFakeSourceGateway } from "../testing/fakeSourceGateway.ts";
import { searchRegions } from "../regionGeometry.ts";
import { fetchInstallationsByAgs } from "../mastrNearby.ts";

// linked-lau /search?q=erlangen — the city LAU plus a same-name neighbour.
const LAU_SEARCH = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<https://wunderfacts.com/lau/lau/DE_09562000#it> a skos:Concept ;
  skos:notation "DE_09562000" ; skos:prefLabel "Erlangen"@de .
<https://wunderfacts.com/lau/lau/DE_09572127#it> a skos:Concept ;
  skos:notation "DE_09572127" ; skos:prefLabel "Erlangen-Höchstadt (VGem)"@de .`;

// linked-mastr /filter?ags=09562000 — the renewable units in that municipality.
const MASTR_FILTER = `
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo:     <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr:   <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/501#it>
  rdfs:label "PV Erlangen Nord" ; geo:lat 49.610 ; geo:long 11.000 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09562000#it> ;
  mastr:Energietraeger "2495" .
<https://wunderfacts.com/mastr/see/502#it>
  rdfs:label "PV Erlangen Süd" ; geo:lat 49.580 ; geo:long 11.010 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09562000#it> ;
  mastr:Energietraeger "2495" .`;

Deno.test("exploration chain: search 'erlangen' → AGS → /filter → its units", async () => {
  const fake = makeFakeSourceGateway({
    respond: (url) => {
      if (url.includes("lau/search")) return new Response(LAU_SEARCH);
      if (url.includes("mastr/filter")) return new Response(MASTR_FILTER);
      return undefined;
    },
  });
  _setSourceGatewayForTesting(fake.gateway);
  try {
    // 1. keyword → region concept(s), carrying the AGS.
    const matches = await searchRegions("lau", "erlangen");
    const erlangen = matches.find((m) => m.label === "Erlangen");
    assert.ok(erlangen, "found the Erlangen LAU");
    assert.equal(erlangen!.ags, "09562000");

    // 2. region AGS → the municipality's renewable units.
    const units = await fetchInstallationsByAgs(erlangen!.ags);
    assert.deepEqual(
      units.map((u) => u.label).sort(),
      ["PV Erlangen Nord", "PV Erlangen Süd"],
    );
    assert.equal(units[0].ags, "09562000");

    // The chain made exactly the two expected wrapper calls.
    assert.ok(fake.calls.some((c) => c.url.includes("lau/search?q=erlangen")));
    assert.ok(fake.calls.some((c) => c.url.includes("mastr/filter?ags=09562000")));
  } finally {
    _setSourceGatewayForTesting(null);
  }
});
