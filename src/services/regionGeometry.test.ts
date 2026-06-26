/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { _setSourceGatewayForTesting } from "./sources/sourceGateway.ts";
import { makeFakeSourceGateway } from "./testing/fakeSourceGateway.ts";
import {
  gemeindeAgsFromContains,
  normalizeRegionGeometry,
  parseRegionMatches,
  type RegionFeatureCollection,
  regionContainsUrl,
  regionGeometryUrl,
  searchRegions,
} from "./regionGeometry.ts";

const store = (ttl: string, base: string) => parseRdfText(ttl, base);

// --- regionGeometryUrl: grain → NUTS level + German scope --------------------

Deno.test("regionGeometryUrl: land grain → NUTS level 1, parent DE", () => {
  assert.equal(
    regionGeometryUrl("land"),
    "https://wunderfacts.com/nuts/geojson?level=1&parent=DE",
  );
});

Deno.test("regionGeometryUrl: kreis grain → NUTS level 3, parent DE", () => {
  assert.equal(
    regionGeometryUrl("kreis"),
    "https://wunderfacts.com/nuts/geojson?level=3&parent=DE",
  );
});

Deno.test("regionGeometryUrl: gemeinde grain → LAU scoped to the parent Kreis", () => {
  assert.equal(
    regionGeometryUrl("gemeinde", { parent: "DE111" }),
    "https://wunderfacts.com/lau/geojson?parent=DE111",
  );
});

Deno.test("regionGeometryUrl: gemeinde grain → LAU scoped to a viewport bbox", () => {
  assert.equal(
    regionGeometryUrl("gemeinde", { bbox: "9.1,48.6,9.3,48.9" }),
    "https://wunderfacts.com/lau/geojson?bbox=9.1%2C48.6%2C9.3%2C48.9",
  );
});

Deno.test("regionGeometryUrl: gemeinde without a scope throws", () => {
  assert.throws(() => regionGeometryUrl("gemeinde"), /requires a parent Kreis or a bbox/);
});

// --- normalizeRegionGeometry: keep joinable shapes, drop the rest ------------

const FIXTURE = {
  type: "FeatureCollection",
  features: [
    // joinable Bundesland
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[[[9, 48], [9, 49], [10, 49], [9, 48]]]] },
      properties: { code: "DE1", ags: "08", label: "Baden-Württemberg", level: 1 },
    },
    // no ags → dropped (can't join to regionalstatistik)
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      properties: { code: "FR1", label: "Île-de-France", level: 1 },
    },
    // no geometry → dropped
    {
      type: "Feature",
      geometry: null,
      properties: { code: "DE2", ags: "09", label: "Bayern", level: 1 },
    },
    // empty ags → dropped
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[1, 1], [1, 2], [2, 2], [1, 1]]] },
      properties: { code: "DE3", ags: "", label: "Berlin" },
    },
  ],
};

Deno.test("normalizeRegionGeometry: keeps only features with geometry AND ags", () => {
  const fc: RegionFeatureCollection = normalizeRegionGeometry(FIXTURE);
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 1);
  const f = fc.features[0];
  assert.equal(f.properties.ags, "08");
  assert.equal(f.properties.code, "DE1");
  assert.equal(f.properties.label, "Baden-Württemberg");
  assert.equal(f.properties.level, 1);
  assert.equal(f.geometry.type, "MultiPolygon");
});

Deno.test("normalizeRegionGeometry: coerces missing code/label to empty strings", () => {
  const fc = normalizeRegionGeometry({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      properties: { ags: "08111" },
    }],
  });
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].properties.code, "");
  assert.equal(fc.features[0].properties.label, "");
  assert.equal(fc.features[0].properties.level, undefined);
});

Deno.test("normalizeRegionGeometry: empty / malformed input → empty collection", () => {
  assert.deepEqual(normalizeRegionGeometry({ type: "FeatureCollection", features: [] }).features, []);
  assert.deepEqual(normalizeRegionGeometry(null).features, []);
  assert.deepEqual(normalizeRegionGeometry({}).features, []);
});

// --- /contains point-in-region lookup ----------------------------------------

Deno.test("regionContainsUrl: builds the LAU /contains lat/lon query", () => {
  assert.equal(
    regionContainsUrl(49.4521, 11.0767),
    "https://wunderfacts.com/lau/contains?lat=49.4521&lon=11.0767",
  );
});

Deno.test("gemeindeAgsFromContains: the containing Gemeinde's AGS from the SKOS response", () => {
  // The live shape (linked-lau /contains): the containing Gemeinde as a skos:Concept whose
  // notation is the AGS prefixed `DE_`. We strip non-digits and keep the 8-digit one.
  const BASE = "https://wunderfacts.com/lau/contains?lat=49.4521&lon=11.0767";
  const hit = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix geosparql: <http://www.opengis.net/ont/geosparql#> .
<lau/DE_09564000#it> a skos:Concept ;
  skos:notation "DE_09564000" ; skos:prefLabel "Nürnberg"@de .
[ a geo:Point ; geosparql:sfWithin <lau/DE_09564000#it> ; geo:lat 49.4521 ; geo:long 11.0767 ] .
`;
  assert.equal(gemeindeAgsFromContains(store(hit, BASE)), "09564000");
  // Nothing contains the point → no concept → null.
  assert.equal(gemeindeAgsFromContains(store("", BASE)), null);
  // Coarser-only notations (NUTS codes) don't yield 8 digits → null.
  const nutsOnly =
    `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n<n> a skos:Concept ; skos:notation "DE254" .`;
  assert.equal(gemeindeAgsFromContains(store(nutsOnly, BASE)), null);
});

// ── searchRegions: the LAU keyword discovery that opens the exploration path ────
const LAU_SEARCH = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<https://wunderfacts.com/lau/lau/DE_09562000#it> a skos:Concept ;
  skos:notation "DE_09562000" ; skos:prefLabel "Erlangen"@de .
<https://wunderfacts.com/lau/lau/DE_09572127#it> a skos:Concept ;
  skos:notation "DE_09572127" ; skos:prefLabel "Erlangen-Höchstadt (VGem)"@de .`;

Deno.test("parseRegionMatches: LAU notation → 8-digit AGS, label", () => {
  const matches = parseRegionMatches(store(LAU_SEARCH, "https://wunderfacts.com/lau/search"));
  const erlangen = matches.find((m) => m.notation === "DE_09562000");
  assert.ok(erlangen);
  assert.equal(erlangen!.ags, "09562000");
  assert.equal(erlangen!.label, "Erlangen");
  // A NUTS code yields no AGS.
  const nuts = parseRegionMatches(
    store(`@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<x> skos:notation "DE254" .`, "x"),
  );
  assert.equal(nuts[0].ags, "");
});

Deno.test("searchRegions hits /search?q= and parses matches (gateway-stubbed)", async () => {
  const fake = makeFakeSourceGateway({ respond: () => new Response(LAU_SEARCH) });
  _setSourceGatewayForTesting(fake.gateway);
  try {
    const matches = await searchRegions("lau", "erlangen");
    assert.ok(matches.some((m) => m.ags === "09562000"));
    assert.ok(fake.calls.some((c) => c.url.includes("lau/search?q=erlangen")));
  } finally {
    _setSourceGatewayForTesting(null);
  }
});
