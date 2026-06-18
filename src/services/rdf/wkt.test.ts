import { assertEquals } from "jsr:@std/assert";
import { parseWktPolygon } from "./wkt.ts";

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
