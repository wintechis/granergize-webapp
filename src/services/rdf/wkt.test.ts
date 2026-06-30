import { assert, assertEquals } from "jsr:@std/assert";
import { parseWktPolygon, parseWktPolygonZ, utm32nToWgs84 } from "./wkt.ts";

Deno.test("parseWktPolygon: outer ring of a simple POLYGON → [lon,lat] pairs", () => {
  const ring = parseWktPolygon("POLYGON ((11.0 49.4, 11.1 49.4, 11.1 49.5, 11.0 49.5, 11.0 49.4))");
  assertEquals(ring, [
    [11.0, 49.4],
    [11.1, 49.4],
    [11.1, 49.5],
    [11.0, 49.5],
    [11.0, 49.4],
  ]);
});

Deno.test("parseWktPolygon: tolerates a CRS-URI prefix + extra whitespace", () => {
  const ring = parseWktPolygon(
    "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POLYGON((11 49,11.1 49,11.1 49.1,11 49))",
  );
  assertEquals(ring?.length, 4);
  assertEquals(ring?.[0], [11, 49]);
});

Deno.test("parseWktPolygon: ignores interior rings (holes), keeps the outer", () => {
  const ring = parseWktPolygon(
    "POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 2, 1 1))",
  );
  assertEquals(ring, [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
});

Deno.test("parseWktPolygon: non-polygon / malformed → null", () => {
  assertEquals(parseWktPolygon(""), null);
  assertEquals(parseWktPolygon("POINT (11 49)"), null);
  assertEquals(parseWktPolygon("POLYGON ((11 49, 11.1 x))"), null);
});

Deno.test("parseWktPolygon: reprojects a native UTM32N POLYGON Z to WGS84 lon/lat", () => {
  // linked-lod2-by's faithful geometry: CRS-tagged, 3-ordinate, native UTM metres.
  const ring = parseWktPolygon(
    "<http://www.opengis.net/def/crs/EPSG/0/25832> POLYGON Z((652000 5480000 300, " +
      "652010 5480000 300, 652010 5480010 300, 652000 5480000 300))",
  );
  assertEquals(ring?.length, 4);
  const [lon, lat] = ring![0];
  // (652000, 5480000) UTM32N → (11.097319, 49.453629) WGS84 (the wrapper's oracle).
  assert(Math.abs(lon - 11.097319) < 1e-4, `lon ${lon}`);
  assert(Math.abs(lat - 49.453629) < 1e-4, `lat ${lat}`);
});

Deno.test("utm32nToWgs84: matches the wrapper's reprojection oracle", () => {
  const [lon, lat] = utm32nToWgs84(652000, 5480000);
  assert(Math.abs(lon - 11.097319) < 1e-5, `lon ${lon}`);
  assert(Math.abs(lat - 49.453629) < 1e-5, `lat ${lat}`);
});

Deno.test("parseWktPolygonZ: raw [x,y,z] vertices, verbatim (no reprojection)", () => {
  const ring = parseWktPolygonZ(
    "<http://www.opengis.net/def/crs/EPSG/0/25832> POLYGON Z((652000 5480000 300, " +
      "652010 5480000 300, 652010 5480010 310, 652000 5480010 310, 652000 5480000 300))",
  );
  assertEquals(ring?.length, 5);
  assertEquals(ring?.[0], [652000, 5480000, 300]); // native UTM metres, Z kept, not reprojected
  assertEquals(ring?.[2], [652010, 5480010, 310]);
  assertEquals(parseWktPolygonZ("POINT (1 2)"), null);
});
