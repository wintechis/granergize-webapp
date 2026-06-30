/**
 * Minimal WKT → ring parser for the GeoSPARQL `geo:asWKT` literals the geometry wrappers
 * serve (the `linked-inspire`/`linked-osm`/`linked-lod2-by` style: `geo:hasGeometry [ geo:asWKT
 * "POLYGON ((lon lat, …))"^^geo:wktLiteral ]`). Pure; this is the app's first `asWKT` consumer —
 * the region choropleth path uses bulk GeoJSON (`regionGeometry.ts`) instead.
 *
 * Only the OUTER ring of a `POLYGON` is extracted (roof/footprint surfaces are simple polygons;
 * any holes are ignored), always returned as WGS84 `[lon, lat]` pairs. Two input shapes are
 * handled transparently:
 *  - the legacy EPSG:4326 / CRS84 lon/lat ring (`POLYGON ((lon lat, …))`), and
 *  - `linked-lod2-by`'s faithful **native ETRS89/UTM32N (EPSG:25832) `POLYGON Z((x y z, …))`** —
 *    the CRS-URI tag is detected and each vertex is reprojected here ({@link utm32nToWgs84}, no
 *    proj dependency), so all downstream renderers keep receiving lon/lat. The Z ordinate (height)
 *    is dropped — the consumers draw 2-D plans.
 *
 * Returns `null` when the literal isn't a parseable polygon.
 */
export function parseWktPolygon(wkt: string): [number, number][] | null {
  if (!wkt) return null;
  // Optional leading CRS-URI tag, e.g. "<http://www.opengis.net/def/crs/EPSG/0/25832> POLYGON Z((…))".
  const crsMatch = /^\s*<([^>]+)>/.exec(wkt);
  const utm = isUtm32n(crsMatch?.[1]);
  // POLYGON, with an optional Z/M dimensionality token, then the outer ring.
  const m = /POLYGON\s*[ZM]*\s*\(\s*\(([^)]*)\)/i.exec(wkt);
  if (!m) return null;
  const ring: [number, number][] = [];
  for (const vertex of m[1].split(",")) {
    const nums = vertex.trim().split(/\s+/).map(Number);
    if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) {
      return null;
    }
    // x,y (+ optional z, ignored); reproject when the CRS is native UTM32N.
    ring.push(utm ? utm32nToWgs84(nums[0], nums[1]) : [nums[0], nums[1]]);
  }
  return ring.length >= 3 ? ring : null;
}

/** True when a CRS URI denotes ETRS89 / UTM zone 32N (EPSG:25832) — the native CRS
 *  `linked-lod2-by` now serves its geometry in. Matches the OGC (`…/EPSG/0/25832`) and
 *  URN (`urn:ogc:def:crs:EPSG::25832`) forms. */
function isUtm32n(crs: string | undefined): boolean {
  return !!crs && /[:/]25832\b/.test(crs);
}

/**
 * ETRS89 / UTM zone 32N (EPSG:25832) easting/northing → WGS84 `[lon, lat]` in degrees.
 * Standard inverse Transverse-Mercator series (Snyder / USGS PP-1395) on the GRS80 ellipsoid;
 * ETRS89 ≈ WGS84 (sub-metre), so the GRS80 result is used directly. Matches the
 * `linked-lod2-by` wrapper's own `Utm32n.java` (and the dataset pipeline's `utm32nToWgs84`),
 * so the webapp can consume the faithful native-UTM geometry with no proj dependency.
 */
export function utm32nToWgs84(easting: number, northing: number): [number, number] {
  const A = 6378137.0; // GRS80 semi-major axis
  const F = 1.0 / 298.257222101;
  const E2 = F * (2 - F);
  const K0 = 0.9996;
  const FE = 500000.0;
  const LON0 = (9.0 * Math.PI) / 180; // zone-32 central meridian
  const x = easting - FE;
  const m = northing / K0;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = m / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const phi1 = mu +
    (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) +
    (151 * e1 ** 3 / 96) * Math.sin(6 * mu) +
    (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const ep2 = E2 / (1 - E2);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const c1 = ep2 * cos1 * cos1;
  const t1 = tan1 * tan1;
  const n1 = A / Math.sqrt(1 - E2 * sin1 * sin1);
  const r1 = A * (1 - E2) / (1 - E2 * sin1 * sin1) ** 1.5;
  const d = x / (n1 * K0);
  const phi = phi1 -
    (n1 * tan1 / r1) *
      (d * d / 2 -
        (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24 +
        (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) *
          d ** 6 / 720);
  const lon = LON0 +
    (d - (1 + 2 * t1 + c1) * d ** 3 / 6 +
      (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) /
      cos1;
  return [(lon * 180) / Math.PI, (phi * 180) / Math.PI];
}
