/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  fetchNearbyRooftopGeometry,
  fetchRooftopPotential,
  isOpenBuildingIri,
  parseBuilding3dSurfaces,
  parseLod2Address,
  parseBuildingRoofs,
  parseNearbyBuildings,
  parseNearestBuilding,
} from "./lod2Rooftop.ts";
import { computePotential } from "./rooftopPv.ts";
import { _setSourceGatewayForTesting } from "./sourceGateway.ts";
import { makeFakeSourceGateway } from "../testing/fakeSourceGateway.ts";

// ── fetchRooftopPotential: the address shared key beats mere proximity ──────────
const NEARBY_SUMMARY = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<building/NEAR> a lod2:Building ; geo:lat 49.48261 ; geo:long 11.12655 .
<building/FAR>  a lod2:Building ; geo:lat 49.48200 ; geo:long 11.12600 .`;
const roofDoc = (thoroughfare: string) => `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix locn: <http://www.w3.org/ns/locn#> .
<#roof-0> a lod2:RoofSurface ; lod2:area 300 ; lod2:azimuth 180 ; lod2:tilt 35 .
<> a lod2:Building ; geo:lat 49.482 ; geo:long 11.126 ; lod2:buildingHeight 10 ;
  lod2:hasRoofSurface <#roof-0> ; locn:address <#address> .
<#address> a locn:Address ; locn:thoroughfare "${thoroughfare}" .`;

function fakeLod2Gateway() {
  return makeFakeSourceGateway({
    respond: (url) => {
      const body = url.includes("/nearby")
        ? NEARBY_SUMMARY
        : url.includes("/building/NEAR")
        ? roofDoc("Andere Straße 1") // nearest, but a CONFLICTING address
        : url.includes("/building/FAR")
        ? roofDoc("Neumeyerstraße 17") // farther, but the MATCHING address
        : undefined;
      return Promise.resolve(
        body === undefined
          ? undefined
          : new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
      );
    },
  });
}

Deno.test("fetchRooftopPotential prefers the address shared key over the nearest LoD2 building", async () => {
  _setSourceGatewayForTesting(fakeLod2Gateway().gateway);
  try {
    const r = await fetchRooftopPotential(49.4826, 11.1265, undefined, "Neumeyerstraße 17");
    assert.ok(r, "a rooftop potential resolved");
    assert.match(r.iri, /\/building\/FAR$/); // the address match, not the nearer NEAR
  } finally {
    _setSourceGatewayForTesting(null);
  }
});

Deno.test("fetchRooftopPotential falls back to the nearest when no address key is given", async () => {
  _setSourceGatewayForTesting(fakeLod2Gateway().gateway);
  try {
    const r = await fetchRooftopPotential(49.4826, 11.1265); // no wantAddress
    assert.ok(r);
    assert.match(r.iri, /\/building\/NEAR$/); // proximity wins (backward compatible)
  } finally {
    _setSourceGatewayForTesting(null);
  }
});

Deno.test("isOpenBuildingIri: a lod2-by building IRI vs anything else", () => {
  assert.equal(
    isOpenBuildingIri(
      "https://wunderfacts.com/lod2-by/building/DEBY_LOD2_3334563",
    ),
    true,
  );
  // A Pod building, a MaStR unit, and a bare ref are NOT open buildings.
  assert.equal(
    isOpenBuildingIri("https://pod.example/granergize/buildings/b.ttl#it"),
    false,
  );
  assert.equal(
    isOpenBuildingIri("https://wunderfacts.com/mastr/see/100#it"),
    false,
  );
  assert.equal(isOpenBuildingIri("granergize/buildings/b.ttl#it"), false);
});

// A `point` summary slice: two RoofPotential buildings with coordinates. The nearest to the
// query point wins (the granergize building's centroid vs the LoD2 centroid differ slightly).
const POINT_BASE =
  "https://wunderfacts.com/lod2-by/point?lon=11.13&lat=49.61&r=60";
const POINT_TTL = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
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

Deno.test("parseNearbyBuildings lists ALL nearby buildings (no capacity needed), nearest first", () => {
  // Unlike parseNearbyRooftops, it does not require lod2:installableCapacity (the wrapper no
  // longer serves it post-untangle) — it lists the buildings so the app can deref + compute kWp.
  const all = parseNearbyBuildings(POINT_TTL, POINT_BASE, 49.609711, 11.130988);
  assert.equal(all.length, 2);
  assert.ok(all[0].distanceKm <= all[1].distanceKm);
  assert.ok(all[0].iri.includes("/building/"));
});

// A faithful slice of building/DEBY_LOD2_3594699 from the live wrapper: the three roof
// surfaces (south pitched / north pitched / wall) + the building node. It carries BOTH the
// raw geometry AND the wrapper's computed figures, so parsing the surfaces and recomputing
// in-app must reproduce the served installableCapacity/annualYield — proving the untangle is
// faithful before the wrapper ever drops those fields.
const BLDG_BASE = "https://wunderfacts.com/lod2-by/building/DEBY_LOD2_3594699";
const BLDG_TTL = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
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
  const ttl = "@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .";
  assert.equal(parseBuildingRoofs(ttl, BLDG_BASE), null);
});

// The footprint the wrapper serves (the GeoSPARQL pair, as in linked-inspire) — the per-roof
// geometry is a NAMED node `<#roof-N-geom>`, exactly as served live. Additive: one surface
// carries `gsp:hasGeometry → gsp:asWKT`, the other does not.
const BLDG_GEOM_TTL = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix gsp: <http://www.opengis.net/ont/geosparql#> .
<#roof-0> a lod2:RoofSurface ; lod2:area 287.5 ; lod2:azimuth 184.5 ; lod2:tilt 38.4 ;
  gsp:hasGeometry <#roof-0-geom> .
<#roof-0-geom> a gsp:Geometry ;
  gsp:asWKT "<http://www.opengis.net/def/crs/EPSG/0/25832> POLYGON Z((654000 5497000 320, 654010 5497000 320, 654010 5497010 320, 654000 5497010 320, 654000 5497000 320))"^^gsp:wktLiteral .
<#roof-1> a lod2:RoofSurface ; lod2:area 100 ; lod2:azimuth 4.0 ; lod2:tilt 38.0 .
<> a lod2:RoofPotential ; geo:lat 49.61 ; geo:long 11.13 ;
  lod2:hasRoofSurface <#roof-0> , <#roof-1> .
`;

Deno.test("parseBuildingRoofs reads the faithful UTM POLYGON Z footprint, reprojected to WGS84", () => {
  const b = parseBuildingRoofs(BLDG_GEOM_TTL, BLDG_BASE);
  assert.ok(b);
  const withGeom = b.roofs.find((r) => r.polygon);
  assert.ok(withGeom, "a surface carries a polygon ring");
  assert.equal(withGeom.polygon?.length, 5);
  // The wrapper now serves native UTM32N; parseWktPolygon reprojects to WGS84 lon/lat
  // (NOT the raw ~654000 easting), so the renderers keep receiving degrees.
  const [lon, lat] = withGeom.polygon![0];
  assert.ok(lon > 10.5 && lon < 11.5, `reprojected lon ${lon}`);
  assert.ok(lat > 49.5 && lat < 49.7, `reprojected lat ${lat}`);
  // The other surface simply lacks geometry — additive, the PV calc is unaffected.
  assert.equal(b.roofs.filter((r) => !r.polygon).length, 1);
});

Deno.test("parseBuilding3dSurfaces: all surface kinds with native-UTM 3D rings", () => {
  const base = "https://wunderfacts.com/lod2-by/building/DEBY_LOD2_1";
  const ttl = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix gsp: <http://www.opengis.net/ont/geosparql#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<building/DEBY_LOD2_1> a lod2:Building ; geo:lat 49.45 ; geo:long 11.08 ;
  gsp:hasGeometry <building/DEBY_LOD2_1#ground-0-geom> ;
  lod2:hasRoofSurface <building/DEBY_LOD2_1#roof-0> ;
  lod2:hasWallSurface <building/DEBY_LOD2_1#wall-0> ;
  lod2:hasGroundSurface <building/DEBY_LOD2_1#ground-0> .
<building/DEBY_LOD2_1#roof-0> a lod2:RoofSurface ; gsp:hasGeometry <building/DEBY_LOD2_1#roof-0-geom> .
<building/DEBY_LOD2_1#roof-0-geom> gsp:asWKT "<http://www.opengis.net/def/crs/EPSG/0/25832> POLYGON Z((652000 5480000 310, 652010 5480000 310, 652010 5480010 310, 652000 5480000 310))"^^gsp:wktLiteral .
<building/DEBY_LOD2_1#wall-0> a lod2:WallSurface ; gsp:hasGeometry <building/DEBY_LOD2_1#wall-0-geom> .
<building/DEBY_LOD2_1#wall-0-geom> gsp:asWKT "POLYGON Z((652000 5480000 300, 652010 5480000 300, 652010 5480000 310, 652000 5480000 300))"^^gsp:wktLiteral .
<building/DEBY_LOD2_1#ground-0> a lod2:GroundSurface ; gsp:hasGeometry <building/DEBY_LOD2_1#ground-0-geom> .
<building/DEBY_LOD2_1#ground-0-geom> gsp:asWKT "POLYGON Z((652000 5480000 300, 652010 5480000 300, 652010 5480010 300, 652000 5480000 300))"^^gsp:wktLiteral .`;
  const surfaces = parseBuilding3dSurfaces(ttl, base);
  assert.equal(surfaces.length, 3); // roof + wall + ground; the building's footprint alias is skipped
  assert.deepEqual(surfaces.map((s) => s.kind).sort(), [
    "ground",
    "roof",
    "wall",
  ]);
  const roof = surfaces.find((s) => s.kind === "roof")!;
  assert.deepEqual(roof.ring[0], [652000, 5480000, 310]); // native UTM, Z kept
  assert.equal(
    parseBuilding3dSurfaces("@prefix x: <urn:x#> . <#b> a x:Other .", base)
      .length,
    0,
  );
});

Deno.test("parseLod2Address: reads the locn:Address (street + locality), null when absent", () => {
  const base = "https://wunderfacts.com/lod2-by/building/DEBY_LOD2_550";
  const ttl = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix locn: <http://www.w3.org/ns/locn#> .
<building/DEBY_LOD2_550> a lod2:Building ; locn:address <building/DEBY_LOD2_550#address> .
<building/DEBY_LOD2_550#address> a locn:Address ;
  locn:thoroughfare "Fischbacher Hauptstraße 170a" ;
  locn:postName "Nürnberg" ;
  locn:adminUnitL1 "Germany" ;
  locn:fullAddress "Fischbacher Hauptstraße 170a, Nürnberg, Germany" .`;
  const a = parseLod2Address(ttl, base);
  assert.ok(a);
  assert.equal(a.thoroughfare, "Fischbacher Hauptstraße 170a");
  assert.equal(a.postName, "Nürnberg");
  assert.equal(a.fullAddress, "Fischbacher Hauptstraße 170a, Nürnberg, Germany");
  // An unaddressed building (~59% of them) → null.
  assert.equal(
    parseLod2Address(
      "@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> . <#b> a lod2:Building .",
      base,
    ),
    null,
  );
});

Deno.test("parseNearestBuilding skips the /nearby LIDS query-point entity (picks a building)", () => {
  // The renamed /nearby endpoint returns a LIDS call entity <nearby?…#id> a geo:Point carrying
  // the EXACT query coordinate — it must NOT win as 'nearest' over the actual buildings.
  const url = "https://wunderfacts.com/lod2-by/nearby?lon=11.13&lat=49.61&r=60";
  const ttl = `
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
<nearby?lat=49.61&lon=11.13&r=60.0#id> a geo:Point ; geo:lat 49.61 ; geo:long 11.13 ;
  lod2:nearby <https://wunderfacts.com/lod2-by/building/A> .
<https://wunderfacts.com/lod2-by/building/A> a lod2:Building ; geo:lat 49.6101 ; geo:long 11.1301 .
`;
  const n = parseNearestBuilding(ttl, url, 49.61, 11.13);
  assert.ok(n);
  assert.equal(n.iri, "https://wunderfacts.com/lod2-by/building/A");
});

// ── fetchNearbyRooftopGeometry: one deref per building ─────────────────────────

Deno.test("fetchNearbyRooftopGeometry derefs each building ONCE (kWp + roofs from one document)", async () => {
  // The kWp rating and the roof footprints live in the SAME dereferenced
  // building document. Deriving them in two passes (rate first, then re-fetch
  // for geometry) cost 2N wrapper requests where N suffice — against a wrapper
  // the module itself says to be polite to.
  const { gateway, calls } = fakeLod2Gateway();
  _setSourceGatewayForTesting(gateway);
  try {
    const out = await fetchNearbyRooftopGeometry(49.4826, 11.1265);
    assert.equal(out.length, 2, "both nearby buildings rated");
    assert.ok(
      out.every((r) => r.installableKwp > 0 && r.roofs.length > 0),
      "each entry carries the kWp AND its roof surfaces",
    );
    for (const b of ["NEAR", "FAR"]) {
      assert.equal(
        calls.filter((c) => c.url.includes(`/building/${b}`)).length,
        1,
        `building ${b} dereferenced exactly once, not twice`,
      );
    }
  } finally {
    _setSourceGatewayForTesting(null);
  }
});
