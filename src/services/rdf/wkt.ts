/**
 * Minimal WKT → ring parser for the GeoSPARQL `geo:asWKT` literals the geometry wrappers
 * serve (the `linked-inspire`/`linked-osm`/`linked-lod2-by` style: `geo:hasGeometry [ geo:asWKT
 * "POLYGON ((lon lat, …))"^^geo:wktLiteral ]`, EPSG:4326 lon/lat). Pure; this is the app's first
 * `asWKT` consumer — the region choropleth path uses bulk GeoJSON (`regionGeometry.ts`) instead.
 *
 * Only the OUTER ring of a `POLYGON` is extracted (roof surfaces are simple polygons; any holes
 * are ignored), as `[lon, lat]` pairs. Returns `null` when the literal isn't a parseable polygon.
 */
export function parseWktPolygon(wkt: string): [number, number][] | null {
  if (!wkt) return null;
  // Tolerate an optional CRS-URI prefix ("<http://…/CRS84> POLYGON ((…))").
  const m = /POLYGON\s*\(\s*\(([^)]*)\)/i.exec(wkt);
  if (!m) return null;
  const ring: [number, number][] = [];
  for (const pair of m[1].split(",")) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 3 ? ring : null;
}
