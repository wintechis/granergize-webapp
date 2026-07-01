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
 * coordinate: `nearby?lon&lat&r` returns the buildings near a point; the nearest is
 * dereferenced for its roof surfaces (and, for the 3D viewer, its full roof/wall/ground solid).
 *
 * Off-Pod and queried — reached through {@link trackedFetch}. Bavaria-only (the pilot dump):
 * a location the dump doesn't cover yields no match and degrades to `null`, so the card
 * simply does not appear. The parse halves are split out pure for offline testing.
 */
import { GEO_LAT, GEO_LONG } from "../rdf/vocabularies.ts";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { computePotential, type RoofSurface } from "./rooftopPv.ts";
import { parseWktPolygon, parseWktPolygonZ } from "../rdf/wkt.ts";

const LOD2_NS = "https://w3id.org/linked-lod2-by/vocab#";
const HAS_ROOF_SURFACE = `${LOD2_NS}hasRoofSurface`;
const TILT = `${LOD2_NS}tilt`;
const AZIMUTH = `${LOD2_NS}azimuth`;
const AREA = `${LOD2_NS}area`;
const HEIGHT = `${LOD2_NS}buildingHeight`;
const INSTALLABLE_CAPACITY = `${LOD2_NS}installableCapacity`;
// The thematic boundary-surface classes (faithful wrapper: roof + wall + ground).
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SURFACE_KIND: Record<string, "roof" | "wall" | "ground"> = {
  [`${LOD2_NS}RoofSurface`]: "roof",
  [`${LOD2_NS}WallSurface`]: "wall",
  [`${LOD2_NS}GroundSurface`]: "ground",
};
// GeoSPARQL canonical pair — the surface footprint the wrapper adds (linked-inspire style).
const GEO_NS = "http://www.opengis.net/ont/geosparql#";
const HAS_GEOMETRY = `${GEO_NS}hasGeometry`;
const AS_WKT = `${GEO_NS}asWKT`;

// W3C Core Location Vocabulary — the building's postal address (bldg:address, INSPIRE-aligned).
const LOCN_NS = "http://www.w3.org/ns/locn#";
const LOCN_ADDRESS = `${LOCN_NS}address`;
const LOCN_THOROUGHFARE = `${LOCN_NS}thoroughfare`;
const LOCN_POSTNAME = `${LOCN_NS}postName`;
const LOCN_ADMINUNITL1 = `${LOCN_NS}adminUnitL1`;
const LOCN_FULLADDRESS = `${LOCN_NS}fullAddress`;

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
  /** The building's roof surfaces (each with its WKT `polygon` within the dump's coverage) — for
   *  the roof-plan. The PV figures above are the aggregate over the suitable ones. */
  roofs: RoofSurface[];
}

/** Half-width of the location search box, in metres (LoD2 vs footprint centroids differ). */
export const DEFAULT_RADIUS_M = 60;

/** Neighbourhood radius for the nearby-rooftops layer, in metres — larger than
 *  {@link DEFAULT_RADIUS_M} (which finds the one building under the pin): a small block of
 *  surrounding buildings, capped at {@link NEARBY_ROOFTOP_LIMIT} (dense blocks return many). */
export const NEARBY_ROOFTOP_RADIUS_M = 250;
export const NEARBY_ROOFTOP_LIMIT = 60;

/** Base IRI of linked-lod2-by — delegates to the registry resolver (env-overridable). */
function lod2Base(): string {
  return sourceBase("lod2-by");
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The `nearby` query IRI for a coordinate (also the Developer-mode source link). The
 *  endpoint was renamed `point` → `nearby` in the 2026-06-30 linked-lod2-by LIDS rename. */
export function rooftopPointUrl(
  lat: number,
  long: number,
  radiusM = DEFAULT_RADIUS_M,
): string {
  return `${lod2Base()}nearby?lon=${long}&lat=${lat}&r=${radiusM}`;
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
  let best:
    | { iri: string; lat: number; long: number; distanceKm: number }
    | null = null;
  for (const latQuad of store.getQuads(null, GEO_LAT, null, null)) {
    const subject = latQuad.subject;
    // Only buildings — skip the LIDS call entity (`<nearby?…#id>` a geo:Point), which carries
    // the exact query coordinate and would otherwise always win as "nearest".
    if (!subject.value.includes("/building/")) continue;
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

/** One nearby building's rooftop-PV potential, straight from the `point` summary — no deref
 *  needed (the summary already carries the installable kWp alongside the coordinates). */
export interface NearbyRooftop {
  iri: string;
  /** Installable PV capacity [kWp] — the wrapper's `lod2:installableCapacity`. */
  installableKwp: number;
  lat: number;
  long: number;
  /** Great-circle distance from the query point [km]. */
  distanceKm: number;
}

/**
 * From a `point` summary document, ALL nearby buildings carrying a rooftop-PV figure, sorted
 * nearest-first. Pure (network-free) — the multi-building sibling of {@link parseNearestBuilding};
 * buildings without an `installableCapacity` are skipped.
 */
export function parseNearbyRooftops(
  turtle: string,
  baseIri: string,
  fromLat: number,
  fromLong: number,
): NearbyRooftop[] {
  const store = parseRdfText(turtle, baseIri);
  const out: NearbyRooftop[] = [];
  for (const latQuad of store.getQuads(null, GEO_LAT, null, null)) {
    const subject = latQuad.subject;
    if (!subject.value.includes("/building/")) continue; // skip the LIDS call entity
    const lat = Number.parseFloat(latQuad.object.value);
    const longQ = store.getQuads(subject, GEO_LONG, null, null)[0];
    const capQ = store.getQuads(subject, INSTALLABLE_CAPACITY, null, null)[0];
    if (!longQ || !capQ || Number.isNaN(lat)) continue;
    const long = Number.parseFloat(longQ.object.value);
    const installableKwp = Number.parseFloat(capQ.object.value);
    if (Number.isNaN(long) || Number.isNaN(installableKwp)) continue;
    out.push({
      iri: subject.value,
      installableKwp,
      lat,
      long,
      distanceKm: haversineKm(fromLat, fromLong, lat, long),
    });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

/**
 * From a `nearby` summary document, ALL nearby buildings (iri + coordinates + distance),
 * nearest-first — the geometry-only sibling of {@link parseNearbyRooftops} that does NOT require
 * a wrapper-served `lod2:installableCapacity` (the PV-calc untangle removed it; kWp is computed
 * app-side per building by dereferencing it). Skips the LIDS call entity. Pure (network-free).
 */
export function parseNearbyBuildings(
  turtle: string,
  baseIri: string,
  fromLat: number,
  fromLong: number,
): { iri: string; lat: number; long: number; distanceKm: number }[] {
  const store = parseRdfText(turtle, baseIri);
  const out: { iri: string; lat: number; long: number; distanceKm: number }[] = [];
  for (const latQuad of store.getQuads(null, GEO_LAT, null, null)) {
    const subject = latQuad.subject;
    if (!subject.value.includes("/building/")) continue; // skip the LIDS call entity
    const lat = Number.parseFloat(latQuad.object.value);
    const longQ = store.getQuads(subject, GEO_LONG, null, null)[0];
    if (!longQ || Number.isNaN(lat)) continue;
    const long = Number.parseFloat(longQ.object.value);
    if (Number.isNaN(long)) continue;
    out.push({
      iri: subject.value,
      lat,
      long,
      distanceKm: haversineKm(fromLat, fromLong, lat, long),
    });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
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
export function parseBuildingRoofs(
  turtle: string,
  baseIri: string,
): BuildingRoofs | null {
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
    if (
      Number.isNaN(areaM2) || Number.isNaN(tiltDeg) || Number.isNaN(azimuthDeg)
    ) continue;
    const surface: RoofSurface = { areaM2, tiltDeg, azimuthDeg };
    // The footprint (`gsp:hasGeometry → gsp:asWKT`), served within the dump's coverage — additive.
    const geomNode = store.getQuads(node, HAS_GEOMETRY, null, null)[0]?.object;
    const wkt = geomNode &&
      store.getQuads(geomNode, AS_WKT, null, null)[0]?.object.value;
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

/** One thematic boundary surface of the building, as a native-UTM 3D ring — for the 3D viewer. */
export interface Surface3d {
  kind: "roof" | "wall" | "ground";
  /** Exterior ring, native ETRS89/UTM32N `[x, y, z]` metres (verbatim, not reprojected). */
  ring: [number, number, number][];
}

/** A building's authoritative postal address from LoD2-BY (`bldg:address`, xAL → `locn:Address`).
 *  `thoroughfare` bundles street + house number as the source does; there is no postal code. */
export interface Lod2Address {
  thoroughfare?: string;
  postName?: string;
  adminUnitL1?: string;
  fullAddress?: string;
}

/** A building's full 3D solid + its LoD2 postal address + the lod2-by resource IRI it came from. */
export interface Building3d {
  iri: string;
  surfaces: Surface3d[];
  address: Lod2Address | null;
}

/**
 * Parse the building's postal address (the `locn:Address` node linked by `locn:address`) from its
 * dereferenced LoD2-BY document. Pure. `null` when the building carries no address (~59% of them —
 * outbuildings — have none).
 */
export function parseLod2Address(turtle: string, baseIri: string): Lod2Address | null {
  const store = parseRdfText(turtle, baseIri);
  const node = store.getQuads(null, LOCN_ADDRESS, null, null)[0]?.object;
  if (!node) return null;
  const lit = (p: string) => store.getQuads(node, p, null, null)[0]?.object.value || undefined;
  const address: Lod2Address = {
    thoroughfare: lit(LOCN_THOROUGHFARE),
    postName: lit(LOCN_POSTNAME),
    adminUnitL1: lit(LOCN_ADMINUNITL1),
    fullAddress: lit(LOCN_FULLADDRESS),
  };
  return address.thoroughfare || address.postName || address.fullAddress ? address : null;
}

/**
 * Parse a building's FULL measured solid — every `lod2:RoofSurface`/`WallSurface`/`GroundSurface`
 * with its native-UTM 3D ring — from its dereferenced document. Pure. The 3D viewer renders these
 * directly in UTM metres (orthogonal/planar). Empty array when the building carries no geometry.
 */
export function parseBuilding3dSurfaces(
  turtle: string,
  baseIri: string,
): Surface3d[] {
  const store = parseRdfText(turtle, baseIri);
  const out: Surface3d[] = [];
  for (const g of store.getQuads(null, HAS_GEOMETRY, null, null)) {
    let kind: "roof" | "wall" | "ground" | undefined;
    for (const t of store.getQuads(g.subject, RDF_TYPE, null, null)) {
      kind = SURFACE_KIND[t.object.value];
      if (kind) break;
    }
    if (!kind) continue; // skip the building's own back-compat footprint geometry alias
    const wkt = store.getQuads(g.object, AS_WKT, null, null)[0]?.object.value;
    const ring = wkt ? parseWktPolygonZ(wkt) : null;
    if (ring) out.push({ kind, ring });
  }
  return out;
}

/**
 * Fetch the full 3D solid (roof/wall/ground surfaces) of the building nearest (`lat`, `long`):
 * the same `nearby` lookup + per-building deref as {@link fetchRooftopPotential}, parsed for ALL
 * surfaces in native UTM. `null` outside the dump's coverage (no match / 404) or no geometry.
 */
export async function fetchBuilding3d(
  lat: number,
  long: number,
  radiusM = DEFAULT_RADIUS_M,
): Promise<Building3d | null> {
  const pointUrl = rooftopPointUrl(lat, long, radiusM);
  const res = await getSourceGateway().fetch(
    pointUrl,
    { headers: { Accept: "text/turtle" } },
    "building 3D geometry (LoD2-BY)",
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching building 3D geometry`);
  }
  const nearest = parseNearestBuilding(await res.text(), pointUrl, lat, long);
  if (!nearest) return null;
  const detail = await getSourceGateway().fetch(
    nearest.iri,
    { headers: { Accept: "text/turtle" } },
    "building 3D geometry detail (LoD2-BY)",
  );
  if (!detail.ok) return null;
  const ttl = await detail.text();
  const surfaces = parseBuilding3dSurfaces(ttl, nearest.iri);
  const address = parseLod2Address(ttl, nearest.iri);
  return surfaces.length || address
    ? { iri: nearest.iri, surfaces, address }
    : null;
}

/**
 * Fetch the rooftop-PV potential of the building nearest (`lat`, `long`): a `point` lookup
 * to find the nearest lod2-by building, a deref of that building for its roof geometry, then
 * the in-app {@link computePotential}. `null` when the area is outside the dump's coverage
 * (no match / 404) or the building has no suitable roof.
 */
/** Normalized street address for the LoD2 shared-key match: lowercased,
 *  whitespace-collapsed, trimmed. Undefined for an empty/absent value. */
function normalizeAddr(s: string | undefined | null): string | undefined {
  const t = s?.toLowerCase().replace(/\s+/g, " ").trim();
  return t || undefined;
}

/** Dereference a LoD2-BY building document; null when the fetch fails. */
async function fetchLod2Doc(iri: string): Promise<string | null> {
  const res = await getSourceGateway().fetch(
    iri,
    { headers: { Accept: "text/turtle" } },
    "rooftop-PV geometry detail (LoD2-BY)",
  );
  return res.ok ? await res.text() : null;
}

export async function fetchRooftopPotential(
  lat: number,
  long: number,
  radiusM = DEFAULT_RADIUS_M,
  /** The building's own street address (e.g. "Neumeyerstraße 17"). Used as the
   *  shared key: an exact `locn:thoroughfare` match beats mere proximity. */
  wantAddress?: string,
): Promise<RooftopPotential | null> {
  const pointUrl = rooftopPointUrl(lat, long, radiusM);
  const res = await getSourceGateway().fetch(
    pointUrl,
    { headers: { Accept: "text/turtle" } },
    "rooftop-PV geometry (LoD2-BY)",
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching rooftop-PV geometry`);
  }
  const candidates = parseNearbyBuildings(await res.text(), pointUrl, lat, long);
  if (candidates.length === 0) return null;

  // Choose the LoD2 building. Default: the nearest (candidates are distance-sorted).
  // But prefer the ADDRESS SHARED KEY — when the building has a street address and
  // the nearest's OWN `locn:thoroughfare` CONFLICTS with it, a merely-nearer
  // neighbour isn't the building; look for a candidate whose address matches. This
  // is cost-neutral when the nearest is correct or carries no address (one deref);
  // only an actual conflict derefs further candidates. (lod2-by address coverage is
  // partial, so the key only fires where served — the "wrong lod2-by building" fix.)
  let chosen = candidates[0];
  let detailText = await fetchLod2Doc(chosen.iri);
  if (!detailText) return null;
  const want = normalizeAddr(wantAddress);
  if (want) {
    const nearestAddr = normalizeAddr(
      parseLod2Address(detailText, chosen.iri)?.thoroughfare,
    );
    if (nearestAddr && nearestAddr !== want) {
      for (const c of candidates.slice(1)) {
        const text = await fetchLod2Doc(c.iri);
        if (!text) continue;
        if (normalizeAddr(parseLod2Address(text, c.iri)?.thoroughfare) === want) {
          chosen = c;
          detailText = text;
          break;
        }
      }
    }
  }
  const parsed = parseBuildingRoofs(detailText, chosen.iri);
  if (!parsed) return null;
  const potential = computePotential(parsed.roofs);
  if (!potential) return null;
  return {
    iri: parsed.iri,
    ...potential,
    buildingHeightM: parsed.buildingHeightM,
    lat: parsed.lat,
    long: parsed.long,
    distanceKm: chosen.distanceKm,
    roofs: parsed.roofs,
  };
}

/** Whether an IRI is an open lod2-by building (the `open` Buildings tier's items) — used to
 *  route a drill into the in-app open-building detail vs the Pod-backed building page.
 *  Matched by path so it's independent of the (configurable) wrapper host. */
export function isOpenBuildingIri(iri: string): boolean {
  return /\/lod2-by\/building\//.test(iri);
}

/**
 * Fetch the rooftop-PV potential of a SPECIFIC lod2-by building BY ITS IRI — the open-tier
 * detail drilled from the finder/map, vs {@link fetchRooftopPotential}'s by-coordinate
 * lookup. Reuses the same deref + {@link parseBuildingRoofs} + {@link computePotential}.
 * `null` on a non-OK response or a building with no suitable roof. `distanceKm` is 0 (it IS
 * the building, not a neighbour).
 */
export async function fetchOpenBuilding(
  iri: string,
): Promise<RooftopPotential | null> {
  const res = await getSourceGateway().fetch(
    iri,
    { headers: { Accept: "text/turtle" } },
    "open building (LoD2-BY)",
  );
  if (!res.ok) return null;
  const parsed = parseBuildingRoofs(await res.text(), iri);
  if (!parsed) return null;
  const potential = computePotential(parsed.roofs);
  if (!potential) return null;
  return {
    iri: parsed.iri,
    ...potential,
    buildingHeightM: parsed.buildingHeightM,
    lat: parsed.lat,
    long: parsed.long,
    distanceKm: 0,
    roofs: parsed.roofs,
  };
}

/**
 * Fetch the rooftop-PV potential of buildings NEAR (`lat`, `long`): a `nearby` summary query for
 * the nearby buildings, then a per-building deref to compute each one's installable kWp **app-side**
 * ({@link computePotential} over its roof surfaces). Nearest first, capped at `limit`. `[]` outside
 * the dump's coverage (404 / no match).
 *
 * Was summary-only (the wrapper served `lod2:installableCapacity` per building), but the PV-calc
 * untangle moved that figure into the app, so the geometry-only wrapper no longer carries it — the
 * kWp must be computed here, like {@link fetchNearbyRooftopGeometry} derefs for footprints.
 */
export async function fetchNearbyRooftops(
  lat: number,
  long: number,
  radiusM = NEARBY_ROOFTOP_RADIUS_M,
  limit = NEARBY_ROOFTOP_LIMIT,
): Promise<NearbyRooftop[]> {
  const pointUrl = rooftopPointUrl(lat, long, radiusM);
  const res = await getSourceGateway().fetch(
    pointUrl,
    { headers: { Accept: "text/turtle" } },
    "nearby rooftops (LoD2-BY)",
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching nearby rooftops`);
  const buildings = parseNearbyBuildings(await res.text(), pointUrl, lat, long)
    .slice(0, limit);
  const rated = await mapLimit(buildings, NEARBY_GEOM_CONCURRENCY, async (b) => {
    try {
      const detail = await getSourceGateway().fetch(
        b.iri,
        { headers: { Accept: "text/turtle" } },
        "nearby rooftop potential (LoD2-BY)",
      );
      if (!detail.ok) return null;
      const parsed = parseBuildingRoofs(await detail.text(), b.iri);
      const pv = parsed && computePotential(parsed.roofs);
      if (!pv) return null;
      return {
        iri: b.iri,
        installableKwp: pv.installableKwp,
        lat: b.lat,
        long: b.long,
        distanceKm: b.distanceKm,
      };
    } catch {
      return null;
    }
  });
  return rated.filter((r): r is NearbyRooftop => r !== null);
}

/** A nearby building plus its drawable roof footprints (derefed from its document). */
export interface NearbyRooftopGeometry extends NearbyRooftop {
  /** Roof-surface footprints (WKT rings, [lon, lat]); `[]` when the building served none. */
  roofs: RoofSurface[];
}

/** How many of the nearest buildings to deref for footprints — each is one request, so this
 *  is smaller than {@link NEARBY_ROOFTOP_LIMIT} (the cheap points-only cap). */
export const NEARBY_ROOFTOP_GEOM_LIMIT = 24;
/** Concurrency cap for the per-building geometry derefs — be polite to the wrapper. */
const NEARBY_GEOM_CONCURRENCY = 6;

/** Run `fn` over `items` with at most `limit` in flight at once (order preserved). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * Nearby rooftops WITH footprint geometry: the cheap `point` summary, then a per-building deref
 * of the {@link NEARBY_ROOFTOP_GEOM_LIMIT} nearest for their WKT roof surfaces (the same deref
 * {@link fetchRooftopPotential} does, looped + concurrency-capped). A building whose deref fails
 * or serves no geometry comes back with `roofs: []` (the map falls back to a dot for it).
 */
export async function fetchNearbyRooftopGeometry(
  lat: number,
  long: number,
  radiusM = NEARBY_ROOFTOP_RADIUS_M,
  limit = NEARBY_ROOFTOP_GEOM_LIMIT,
): Promise<NearbyRooftopGeometry[]> {
  const summary = await fetchNearbyRooftops(lat, long, radiusM, limit);
  return mapLimit(summary, NEARBY_GEOM_CONCURRENCY, async (r) => {
    try {
      const res = await getSourceGateway().fetch(
        r.iri,
        { headers: { Accept: "text/turtle" } },
        "nearby rooftop geometry (LoD2-BY)",
      );
      if (!res.ok) return { ...r, roofs: [] };
      const parsed = parseBuildingRoofs(await res.text(), r.iri);
      return { ...r, roofs: parsed?.roofs ?? [] };
    } catch {
      return { ...r, roofs: [] };
    }
  });
}
