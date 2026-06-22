/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  isOpenBuildingIri,
  parseBuildingRoofs,
  parseNearbyRooftops,
  parseNearestBuilding,
} from "./lod2Rooftop.ts";
import { computePotential } from "./rooftopPv.ts";

Deno.test("isOpenBuildingIri: a lod2-by building IRI vs anything else", () => {
  assert.equal(
    isOpenBuildingIri("https://wunderfacts.com/lod2-by/building/DEBY_LOD2_3334563"),
    true,
  );
  // A Pod building, a MaStR unit, and a bare ref are NOT open buildings.
  assert.equal(isOpenBuildingIri("https://pod.example/granergize/buildings/b.ttl#it"), false);
  assert.equal(isOpenBuildingIri("https://wunderfacts.com/mastr/see/100#it"), false);
  assert.equal(isOpenBuildingIri("granergize/buildings/b.ttl#it"), false);
});

// A `point` summary slice: two RoofPotential buildings with coordinates. The nearest to the
// query point wins (the granergize building's centroid vs the LoD2 centroid differ slightly).
const POINT_BASE = "https://wunderfacts.com/lod2-by/point?lon=11.13&lat=49.61&r=60";
const POINT_TTL = `
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<https://wunderfacts.com/lod2-by/building/A> a lod2:RoofPotential ;
  geo:lat 49.6098 ; geo:long 11.1310 ; lod2:installableCapacity 40.39 .
<https://wunderfacts.com/lod2-by/building/B> a lod2:RoofPotential ;
  geo:lat 49.6200 ; geo:long 11.1500 ; lod2:installableCapacity 12.0 .
`;

Deno.test("parseNearestBuilding picks the building closest to the query point", () => {
  const n = parseNearestBuilding(POINT_TTL, POINT_BASE, 49.609711, 11.130988);
  assert.ok(n);
  assert.equal(n.iri, "https://wunderfacts.com/lod2-by/building/A");
  assert.ok(n.distanceKm < 0.1);
});

Deno.test("parseNearestBuilding returns null for an empty document", () => {
  assert.equal(parseNearestBuilding("", POINT_BASE, 49, 11), null);
});

Deno.test("parseNearbyRooftops returns ALL buildings with capacity, nearest first", () => {
  const near = parseNearbyRooftops(POINT_TTL, POINT_BASE, 49.609711, 11.130988);
  assert.equal(near.length, 2);
  // A is at the query point, B is ~2 km away → A first.
  assert.equal(near[0].iri, "https://wunderfacts.com/lod2-by/building/A");
  assert.equal(near[0].installableKwp, 40.39);
  assert.equal(near[1].iri, "https://wunderfacts.com/lod2-by/building/B");
  assert.ok(near[0].distanceKm < near[1].distanceKm);
});

Deno.test("parseNearbyRooftops skips buildings without an installable-capacity figure", () => {
  const ttl = `
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<https://wunderfacts.com/lod2-by/building/A> a lod2:RoofPotential ;
  geo:lat 49.61 ; geo:long 11.13 ; lod2:installableCapacity 22.38 .
<https://wunderfacts.com/lod2-by/building/X> a lod2:RoofPotential ;
  geo:lat 49.62 ; geo:long 11.15 .
`;
  const near = parseNearbyRooftops(ttl, POINT_BASE, 49.61, 11.13);
  assert.equal(near.length, 1);
  assert.equal(near[0].iri, "https://wunderfacts.com/lod2-by/building/A");
});

Deno.test("parseNearbyRooftops returns [] for an empty document", () => {
  assert.deepEqual(parseNearbyRooftops("", POINT_BASE, 49, 11), []);
});

// A faithful slice of building/DEBY_LOD2_3594699 from the live wrapper: the three roof
// surfaces (south pitched / north pitched / wall) + the building node. It carries BOTH the
// raw geometry AND the wrapper's computed figures, so parsing the surfaces and recomputing
// in-app must reproduce the served installableCapacity/annualYield — proving the untangle is
// faithful before the wrapper ever drops those fields.
const BLDG_BASE = "https://wunderfacts.com/lod2-by/building/DEBY_LOD2_3594699";
const BLDG_TTL = `
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<#roof-0> a lod2:RoofSurface ; lod2:area 287.506 ; lod2:azimuth 4.55 ; lod2:tilt 38.444 .
<#roof-1> a lod2:RoofSurface ; lod2:area 288.506 ; lod2:azimuth 184.553 ; lod2:tilt 38.442 .
<#roof-2> a lod2:RoofSurface ; lod2:area 117.123 ; lod2:azimuth -1.0 ; lod2:tilt 90.0 .
<> a lod2:RoofPotential ;
  geo:lat 49.609711 ; geo:long 11.130988 ;
  lod2:buildingHeight 14.121 ;
  lod2:hasRoofSurface <#roof-2> , <#roof-1> , <#roof-0> ;
  lod2:installableCapacity 40.39 ;
  lod2:annualYield 41005 ;
  lod2:suitableRoofArea 202.0 ;
  lod2:dominantOrientation "S" .
`;

Deno.test("parseBuildingRoofs reads all roof surfaces + the building identity", () => {
  const b = parseBuildingRoofs(BLDG_TTL, BLDG_BASE);
  assert.ok(b);
  assert.equal(b.iri, BLDG_BASE);
  assert.equal(b.roofs.length, 3);
  assert.equal(b.buildingHeightM, 14.121);
  assert.equal(b.lat, 49.609711);
  assert.equal(b.long, 11.130988);
});

Deno.test("parse + compute reproduces the wrapper's served kWp/kWh (fidelity)", () => {
  const b = parseBuildingRoofs(BLDG_TTL, BLDG_BASE);
  assert.ok(b);
  const p = computePotential(b.roofs);
  assert.ok(p);
  assert.equal(p.installableKwp, 40.39); // served lod2:installableCapacity
  assert.equal(p.annualKwh, 41005); // served lod2:annualYield
  assert.equal(p.suitableAreaM2, 202.0); // served lod2:suitableRoofArea
  assert.equal(p.dominantOrientation, "S"); // served lod2:dominantOrientation
});

Deno.test("parseBuildingRoofs returns null without roof surfaces", () => {
  const ttl = "@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .";
  assert.equal(parseBuildingRoofs(ttl, BLDG_BASE), null);
});

// The footprint the wrapper serves (the GeoSPARQL pair, as in linked-inspire) — the per-roof
// geometry is a NAMED node `<#roof-N-geom>`, exactly as served live. Additive: one surface
// carries `gsp:hasGeometry → gsp:asWKT`, the other does not.
const BLDG_GEOM_TTL = `
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix gsp: <http://www.opengis.net/ont/geosparql#> .
<#roof-0> a lod2:RoofSurface ; lod2:area 287.5 ; lod2:azimuth 184.5 ; lod2:tilt 38.4 ;
  gsp:hasGeometry <#roof-0-geom> .
<#roof-0-geom> a gsp:Geometry ;
  gsp:asWKT "POLYGON((11.130 49.610, 11.131 49.610, 11.131 49.611, 11.130 49.611, 11.130 49.610))"^^gsp:wktLiteral .
<#roof-1> a lod2:RoofSurface ; lod2:area 100 ; lod2:azimuth 4.0 ; lod2:tilt 38.0 .
<> a lod2:RoofPotential ; geo:lat 49.61 ; geo:long 11.13 ;
  lod2:hasRoofSurface <#roof-0> , <#roof-1> .
`;

Deno.test("parseBuildingRoofs reads the geo:asWKT footprint into surface.polygon", () => {
  const b = parseBuildingRoofs(BLDG_GEOM_TTL, BLDG_BASE);
  assert.ok(b);
  const withGeom = b.roofs.find((r) => r.polygon);
  assert.ok(withGeom, "a surface carries a polygon ring");
  assert.equal(withGeom.polygon?.length, 5);
  assert.deepEqual(withGeom.polygon?.[0], [11.13, 49.61]);
  // The other surface simply lacks geometry — additive, the PV calc is unaffected.
  assert.equal(b.roofs.filter((r) => !r.polygon).length, 1);
});
