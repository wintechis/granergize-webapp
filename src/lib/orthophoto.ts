/**
 * Base-layer selection for the building-detail locator thumbnail.
 *
 * The detail map shows a building's location as a close-up aerial image where
 * one is available, falling back to the nationwide street basemap elsewhere.
 *
 * There is **no openly-available DOP20 orthophoto covering all of Germany** — the
 * BKG nationwide DOP WMS (`sgx.geodatenzentrum.de/wms_dop`) is access-restricted
 * (third parties need authorisation). So the high-resolution view uses **Bavaria's
 * open DOP20c** (20 cm RGB, CC BY 4.0) within its coverage, and any building
 * outside Bavaria keeps the basemap raster rather than showing blank DOP tiles.
 * Decision + sources recorded in plans/plan-redesign-parallel-execution.md.
 */

/** Bavaria's open DOP20c WMS — 20 cm true-colour orthophoto (EPSG:3857, WMS 1.1.1). */
export const BAVARIA_DOP20 = {
  url: "https://geoservices.bayern.de/od/wms/dop/v1/dop20",
  layers: "by_dop20c",
  format: "image/jpeg",
  maxZoom: 20,
  attribution:
    '&copy; <a href="https://geodaten.bayern.de/">Bayerische Vermessungsverwaltung</a> (DOP20, CC BY 4.0)',
} as const;

/** Nationwide street basemap (BKG basemap.de) — the fallback outside Bavaria. */
export const BASEMAP_DE = {
  url: "https://sgx.geodatenzentrum.de/wms_basemapde",
  layers: "de_basemapde_web_raster_farbe",
  format: "image/png",
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://basemap.de/">basemap.de</a> / &copy; <a href="https://www.bkg.bund.de/">BKG</a>',
} as const;

export type BaseLayer = typeof BAVARIA_DOP20 | typeof BASEMAP_DE;

/**
 * Bavaria's WMS `LatLonBoundingBox` (from its GetCapabilities) — the orthophoto's
 * coverage envelope, used to decide whether a building falls inside it.
 */
const BAVARIA_BBOX = {
  minLng: 8.96,
  maxLng: 14.03,
  minLat: 47.16,
  maxLat: 50.59,
} as const;

/** Whether a coordinate falls within Bavaria's DOP20 coverage envelope. */
export function inBavaria(lat: number, lng: number): boolean {
  return (
    lat >= BAVARIA_BBOX.minLat && lat <= BAVARIA_BBOX.maxLat &&
    lng >= BAVARIA_BBOX.minLng && lng <= BAVARIA_BBOX.maxLng
  );
}

/**
 * The locator thumbnail's base layer + default zoom for a building at (lat, lng):
 * the Bavaria DOP20c orthophoto zoomed in (highest resolution) where there's
 * coverage, else the nationwide basemap raster at the wider street-map zoom.
 */
export function detailBaseLayer(
  lat: number,
  lng: number,
): { config: BaseLayer; zoom: number } {
  return inBavaria(lat, lng)
    ? { config: BAVARIA_DOP20, zoom: 18 }
    : { config: BASEMAP_DE, zoom: 14 };
}
