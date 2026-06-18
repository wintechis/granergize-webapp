/**
 * Read `linked-lod2-by` (the LDBV LoD2-BY 3D building model, re-published as Linked Data)
 * for the **rooftop-PV potential of THIS building** — the per-building, roof-geometry sibling
 * of the per-Gemeinde {@link ./standortEnergieprofil.ts} (Energie-Atlas aggregate) and
 * {@link ./mastrNearby.ts} (nearby installations).
 *
 * The wrapper serves each building's **measured roof geometry** (`lod2:hasRoofSurface` →
 * `lod2:RoofSurface` with `lod2:tilt`/`lod2:azimuth`/`lod2:area`, + height); the kWp/kWh
 * **PV estimate is computed here** by {@link computePotential} (the untangle — the app is the
 * data-combination layer, see plans/plan-lod2-pv-calc-to-app.md). We locate the building by
 * coordinate: `point?lon&lat&r` returns the buildings near a point; the nearest is
 * dereferenced for its roof surfaces.
 *
 * Off-Pod and queried — reached through {@link trackedFetch}. Bavaria-only (the pilot dump):
 * a location the dump doesn't cover yields no match and degrades to `null`, so the card
 * simply does not appear. The parse halves are split out pure for offline testing.
 */
import { GEO_LAT, GEO_LONG } from "./rdf/vocabularies.ts";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { trackedFetch } from "../lib/networkActivity.ts";
import { computePotential, type RoofSurface } from "./rooftopPv.ts";
import { parseWktPolygon } from "./rdf/wkt.ts";

const LOD2_NS = "https://w3id.org/linked-lod2-by/vocab#";
const HAS_ROOF_SURFACE = `${LOD2_NS}hasRoofSurface`;
const TILT = `${LOD2_NS}tilt`;
const AZIMUTH = `${LOD2_NS}azimuth`;
const AREA = `${LOD2_NS}area`;
const HEIGHT = `${LOD2_NS}buildingHeight`;
// GeoSPARQL canonical pair — the surface footprint the wrapper adds (linked-inspire style).
const GEO_NS = "http://www.opengis.net/ont/geosparql#";
const HAS_GEOMETRY = `${GEO_NS}hasGeometry`;
const AS_WKT = `${GEO_NS}asWKT`;

/** One building's rooftop-PV potential (computed in-app over its LoD2 roof geometry). */
export interface RooftopPotential {
  /** The lod2-by building IRI (deref / the `building/{id}.html` view). */
  iri: string;
  /** Installable PV capacity [kWp]. */
  installableKwp: number;
  /** Expected annual yield [kWh/a]. */
  annualKwh: number;
  /** Usable (suitable) roof area [m²]. */
  suitableAreaM2: number;
  /** Dominant suitable-roof orientation (N/NE/…/NW), or "". */
  dominantOrientation: string;
  /** Building height [m] (LoD2 measuredHeight), when present. */
  buildingHeightM: number | null;
  lat: number;
  long: number;
  /** Great-circle distance from the query point [km]. */
  distanceKm: number;
  /** The building's roof surfaces (with `polygon` when the wrapper serves geometry) — for the
   *  roof-plan. The PV figures above are the aggregate over the suitable ones. */
  roofs: RoofSurface[];
}

/** Half-width of the location search box, in metres (LoD2 vs footprint centroids differ). */
export const DEFAULT_RADIUS_M = 60;

/** Base URI of the linked-lod2-by wrapper. Read lazily so the pure-parser tests never
 *  touch `import.meta.env` (same pattern as {@link mastrNearby}). */
function lod2Base(): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_LOD2_API_URI || "https://wunderfacts.com/lod2-by/";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The `point` query IRI for a coordinate (also the Developer-mode source link). */
export function rooftopPointUrl(lat: number, long: number, radiusM = DEFAULT_RADIUS_M): string {
  return `${lod2Base()}point?lon=${long}&lat=${lat}&r=${radiusM}`;
}

/**
 * From a `point` summary document, the IRI + coordinates of the building nearest to
 * (`fromLat`, `fromLong`), or `null` if none. Pure — the network-free half.
 */
export function parseNearestBuilding(
  turtle: string,
  baseIri: string,
  fromLat: number,
  fromLong: number,
): { iri: string; lat: number; long: number; distanceKm: number } | null {
  const store = parseRdfText(turtle, baseIri);
  let best: { iri: string; lat: number; long: number; distanceKm: number } | null = null;
  for (const latQuad of store.getQuads(null, GEO_LAT, null, null)) {
    const subject = latQuad.subject;
    const lat = Number.parseFloat(latQuad.object.value);
    const longQ = store.getQuads(subject, GEO_LONG, null, null)[0];
    if (!longQ || Number.isNaN(lat)) continue;
    const long = Number.parseFloat(longQ.object.value);
    if (Number.isNaN(long)) continue;
    const distanceKm = haversineKm(fromLat, fromLong, lat, long);
    if (!best || distanceKm < best.distanceKm) {
      best = { iri: subject.value, lat, long, distanceKm };
    }
  }
  return best;
}

/** A building's roof surfaces + identity, parsed from its dereferenced document. Pure. */
export interface BuildingRoofs {
  iri: string;
  lat: number;
  long: number;
  buildingHeightM: number | null;
  roofs: RoofSurface[];
}

/**
 * Parse one building's measured roof geometry (the `lod2:RoofSurface`s) from its
 * dereferenced document. Pure. `null` when the building carries no roof surfaces.
 */
export function parseBuildingRoofs(turtle: string, baseIri: string): BuildingRoofs | null {
  const store = parseRdfText(turtle, baseIri);
  const surfaceQuads = store.getQuads(null, HAS_ROOF_SURFACE, null, null);
  if (surfaceQuads.length === 0) return null;
  const subject = surfaceQuads[0].subject;
  const roofs: RoofSurface[] = [];
  for (const q of surfaceQuads) {
    const node = q.object;
    const area = store.getQuads(node, AREA, null, null)[0];
    const tilt = store.getQuads(node, TILT, null, null)[0];
    const azimuth = store.getQuads(node, AZIMUTH, null, null)[0];
    if (!area || !tilt || !azimuth) continue;
    const areaM2 = Number.parseFloat(area.object.value);
    const tiltDeg = Number.parseFloat(tilt.object.value);
    const azimuthDeg = Number.parseFloat(azimuth.object.value);
    if (Number.isNaN(areaM2) || Number.isNaN(tiltDeg) || Number.isNaN(azimuthDeg)) continue;
    const surface: RoofSurface = { areaM2, tiltDeg, azimuthDeg };
    // The footprint (`geo:hasGeometry → geo:asWKT`), when the wrapper serves it — additive.
    const geomNode = store.getQuads(node, HAS_GEOMETRY, null, null)[0]?.object;
    const wkt = geomNode && store.getQuads(geomNode, AS_WKT, null, null)[0]?.object.value;
    const ring = wkt ? parseWktPolygon(wkt) : null;
    if (ring) surface.polygon = ring;
    roofs.push(surface);
  }
  const num = (p: string): number => {
    const q = store.getQuads(subject, p, null, null)[0];
    return q ? Number.parseFloat(q.object.value) : NaN;
  };
  const height = num(HEIGHT);
  return {
    iri: subject.value,
    lat: num(GEO_LAT),
    long: num(GEO_LONG),
    buildingHeightM: Number.isNaN(height) ? null : height,
    roofs,
  };
}

/**
 * Fetch the rooftop-PV potential of the building nearest (`lat`, `long`): a `point` lookup
 * to find the nearest lod2-by building, a deref of that building for its roof geometry, then
 * the in-app {@link computePotential}. `null` when the area is outside the dump's coverage
 * (no match / 404) or the building has no suitable roof.
 */
export async function fetchRooftopPotential(
  lat: number,
  long: number,
  radiusM = DEFAULT_RADIUS_M,
): Promise<RooftopPotential | null> {
  const pointUrl = rooftopPointUrl(lat, long, radiusM);
  const res = await trackedFetch(
    pointUrl,
    { headers: { Accept: "text/turtle" } },
    "rooftop-PV geometry (LoD2-BY)",
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching rooftop-PV geometry`);
  const nearest = parseNearestBuilding(await res.text(), pointUrl, lat, long);
  if (!nearest) return null;

  const detail = await trackedFetch(
    nearest.iri,
    { headers: { Accept: "text/turtle" } },
    "rooftop-PV geometry detail (LoD2-BY)",
  );
  if (!detail.ok) return null;
  const parsed = parseBuildingRoofs(await detail.text(), nearest.iri);
  if (!parsed) return null;
  const potential = computePotential(parsed.roofs);
  if (!potential) return null;
  return {
    iri: parsed.iri,
    ...potential,
    buildingHeightM: parsed.buildingHeightM,
    lat: parsed.lat,
    long: parsed.long,
    distanceKm: nearest.distanceKm,
    roofs: parsed.roofs,
  };
}
