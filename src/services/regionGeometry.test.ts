/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  gemeindeAgsFromContains,
  normalizeRegionGeometry,
  type RegionFeatureCollection,
  regionContainsUrl,
  regionGeometryUrl,
} from "./regionGeometry.ts";

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
  assert.equal(gemeindeAgsFromContains(hit, BASE), "09564000");
  // Nothing contains the point → no concept → null.
  assert.equal(gemeindeAgsFromContains("", BASE), null);
  // Coarser-only notations (NUTS codes) don't yield 8 digits → null.
  const nutsOnly =
    `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n<n> a skos:Concept ; skos:notation "DE254" .`;
  assert.equal(gemeindeAgsFromContains(nutsOnly, BASE), null);
});
