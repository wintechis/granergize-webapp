/**
 * Region polygons for the statistics **choropleth** — fetched from the
 * `linked-nuts` wrapper's bulk GeoJSON endpoint
 * (`<base>/geojson?level={1|3}&parent=DE`), which returns ONE CORS-enabled
 * FeatureCollection per level: 16 Bundesländer (`level=1`) or ~400 Kreise
 * (`level=3`), each feature carrying the German **`ags`** join key (2-digit Land /
 * 5-digit Kreis), a `label` and the NUTS `code` in its `properties`.
 *
 * The choropleth joins these shapes to AGS-keyed regional statistics
 * ({@link ./regionalCube.ts}); buildings/observations are point-grained, but
 * aggregations are area-grained, so the map cell is a shaded region. Only the
 * small NUTS endpoint is needed — not the 149 MB LAU/Gemeinde layer.
 *
 * Reached through {@link trackedFetch} (global loading indicator + transient-throttle
 * retry), like the weather and regionalstatistik clients. The shape-normalising half
 * is split out pure for offline unit-testing.
 */
import type { Store } from "n3";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { contains, deref, DerefError, search } from "./capabilities.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { sourceKeys } from "./sourceKeys.ts";
import { DCTERMS_IDENTIFIER, SKOS_NS } from "../rdf/vocabularies.ts";
import type { NutsRoute } from "../../generated/nuts.routes.ts";
import type { LauRoute } from "../../generated/lau.routes.ts";

/**
 * The nuts routes the app calls, checked at COMPILE TIME against the wrapper's DEPLOYED route set
 * (`src/generated/nuts.routes.ts`, regenerated from the live `/routes` manifest — `deno task
 * gen:routes:nuts`). A rename/removal upstream makes the literal unassignable to {@link NutsRoute},
 * so `deno task check` fails here rather than the app silently 404ing. (`concept` = the `nuts/{code}#it`
 * region-concept route.) See `explore/explore-wrapper-contract-drift.md`.
 */
export const NUTS_ROUTES = {
  geojson: "geojson",
  search: "search",
  concept: "nuts",
} as const satisfies Record<string, NutsRoute>;

/** The lau routes the app calls, compile-time-checked against the generated {@link LauRoute} union
 *  (`deno task gen:routes:lau`). (`concept` = the `lau/DE_{ags}#it` Gemeinde-concept route.) */
export const LAU_ROUTES = {
  contains: "contains",
  geojson: "geojson",
  search: "search",
  concept: "lau",
} as const satisfies Record<string, LauRoute>;

/**
 * Region grain — Bundesland (NUTS-1, 2-digit AGS) and Kreis (NUTS-3, 5-digit AGS)
 * come whole from `linked-nuts`; Gemeinde (LAU, 8-digit AGS) comes from `linked-lau`
 * scoped to ONE parent Kreis (the EU LAU layer is too big to fetch whole).
 */
export type RegionGrain = "land" | "kreis" | "gemeinde";

/** A GeoJSON Polygon/MultiPolygon geometry (coordinates left opaque — the layer
 *  hands them straight to Leaflet, EPSG:4326). */
export interface RegionGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

/** The `properties` the wrapper attaches to each region feature. */
export interface RegionFeatureProps {
  /** NUTS code, e.g. "DE1" (Land) / "DE111" (Kreis). */
  code: string;
  /** German AGS join key — 2-digit Land / 5-digit Kreis. The choropleth's join to
   *  regionalstatistik; a feature without one is dropped (can't be shaded). */
  ags: string;
  /** Human label, e.g. "Baden-Württemberg". */
  label: string;
  /** NUTS level (1 = Bundesland, 3 = Kreis), when present. */
  level?: number;
}

export interface RegionFeature {
  type: "Feature";
  geometry: RegionGeometry;
  properties: RegionFeatureProps;
}

export interface RegionFeatureCollection {
  type: "FeatureCollection";
  features: RegionFeature[];
}

/** Where a Gemeinde fetch is scoped — the LAU endpoint can't load the whole layer,
 *  so it takes either one parent Kreis (`parent`, a NUTS-3 code) or a viewport
 *  `bbox` ("minLon,minLat,maxLon,maxLat"). Ignored for land/kreis. */
export interface RegionScope {
  parent?: string;
  bbox?: string;
}

/**
 * The bulk-GeoJSON IRI for a grain. Land/Kreis fetch all German regions of a NUTS
 * level in one GET; Gemeinde fetches the LAU layer scoped to a viewport `bbox` (the
 * zoom-driven default) or one parent Kreis — the LAU endpoint requires a scope, so
 * one of the two is mandatory for `gemeinde`.
 */
export function regionGeometryUrl(grain: RegionGrain, scope?: RegionScope): string {
  if (grain === "gemeinde") {
    const base = sourceBase("lau");
    const geo = `${base}${LAU_ROUTES.geojson}`;
    if (scope?.parent) return `${geo}?parent=${encodeURIComponent(scope.parent)}`;
    if (scope?.bbox) return `${geo}?bbox=${encodeURIComponent(scope.bbox)}`;
    throw new Error("gemeinde geometry requires a parent Kreis or a bbox");
  }
  const base = sourceBase("nuts");
  const level = grain === "land" ? 1 : 3;
  return `${base}${NUTS_ROUTES.geojson}?level=${level}&parent=DE`;
}

/**
 * Validate + narrow a raw FeatureCollection to the joinable region features. Pure —
 * the network-free half, unit-tested with a fixture. Drops any feature missing a
 * geometry or a (non-empty) `ags`, since an un-keyed/shapeless region can't be
 * shaded; coerces `code`/`label` to strings.
 */
export function normalizeRegionGeometry(raw: unknown): RegionFeatureCollection {
  const fc = raw as { features?: unknown[] } | null | undefined;
  const features: RegionFeature[] = [];
  for (const f of fc?.features ?? []) {
    const feat = f as {
      geometry?: { type?: string; coordinates?: unknown } | null;
      properties?: Record<string, unknown> | null;
    };
    const geom = feat.geometry;
    const props = feat.properties ?? {};
    const ags = props.ags;
    if (!geom || geom.coordinates == null) continue;
    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") continue;
    if (typeof ags !== "string" || ags === "") continue;
    features.push({
      type: "Feature",
      geometry: { type: geom.type, coordinates: geom.coordinates },
      properties: {
        code: String(props.code ?? ""),
        ags,
        label: String(props.label ?? ""),
        level: typeof props.level === "number" ? props.level : undefined,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Fetch + normalise the region polygons for a grain. Throws on a non-OK response
 * (the caller's query surfaces it).
 */
export async function fetchRegionGeometry(
  grain: RegionGrain,
  scope?: RegionScope,
): Promise<RegionFeatureCollection> {
  // The bulk geojson feed is JSON, not RDF — a non-vocabulary read, so it uses
  // the gateway's bare fetch rather than a capability helper.
  const url = regionGeometryUrl(grain, scope);
  const res = await getSourceGateway().fetch(
    url,
    { headers: { Accept: "application/geo+json" } },
    `region geometry ${grain}`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching region geometry (${grain})`);
  }
  return normalizeRegionGeometry(await res.json());
}

/**
 * The point-in-region lookup IRI: `…/contains?lat=&lon=` resolves the region whose polygon
 * contains the point. We ask **linked-lau** for the Gemeinde (LAU); since the AGS nests by prefix
 * (Gemeinde → Kreis → Land), that one answer derives every coarser grain, so the NUTS wrapper
 * isn't needed here.
 */
export function regionContainsUrl(lat: number, long: number): string {
  const base = sourceBase("lau");
  return `${base}${LAU_ROUTES.contains}?lat=${lat}&lon=${long}`;
}

/**
 * The national (NUTS-0 `DE`, "Deutschland") region concept IRI — the catch-all extent for an
 * aggregation whose members span several Bundesländer (so they share no Land-or-finer AGS). It's a
 * NUTS concept, not an AGS one: AGS has no national code (it starts at the 2-digit Land), so this
 * references the linked-nuts `DE` `skos:Concept` rather than the `…/ags/{code}` scheme the finer
 * levels use. There is no national choropleth polygon, so this never shades on the Kreis/Land map.
 */
export function nationalRegionUrl(): string {
  const base = sourceBase("nuts");
  return `${base}${NUTS_ROUTES.concept}/DE#it`;
}

/**
 * The 8-digit Gemeinde AGS from a linked-lau `/contains` SKOS response, or `null` when nothing
 * contains the point. The wrapper returns the containing Gemeinde as a `skos:Concept` whose
 * `skos:notation` is the AGS prefixed `DE_` (e.g. `"DE_09564000"`); we strip non-digits and keep
 * the entry that yields exactly 8 (the Gemeinde — coarser NUTS concepts, if present, notate as
 * `DE25`/`DE254`, which don't). Pure.
 */
export function gemeindeAgsFromContains(store: Store): string | null {
  for (const q of store.getQuads(null, `${SKOS_NS}notation`, null, null)) {
    const digits = q.object.value.replace(/\D/g, "");
    if (digits.length === 8) return digits;
  }
  return null;
}

/**
 * Resolve the 8-digit Gemeinde AGS whose LAU polygon contains (`lat`, `long`), via the wrapper's
 * `/contains` lookup. Best-effort: `null` outside the layer's coverage / when nothing matches
 * (the aggregation then declines a region — point/centroid fallback).
 */
export async function fetchContainingGemeindeAgs(
  lat: number,
  long: number,
): Promise<string | null> {
  try {
    return await fetchContainingGemeindeAgsOrThrow(lat, long);
  } catch {
    return null; // best-effort: unreachable → no region
  }
}

/**
 * {@link fetchContainingGemeindeAgs}, except a TRANSPORT failure (network/CORS
 * rejection, wrapper 5xx) throws instead of reading as "no region" — a definitive
 * 404/410 ("nothing contains the point") still returns `null`. A bulk caller (the
 * demo seed's {@link ../geocode.ts | makeGeocodeOrAdoptCoords}) needs the
 * distinction: with the wrapper down, every attempt costs the full transient-retry
 * backoff, so after one hard failure it stops asking for the rest of the run.
 */
export async function fetchContainingGemeindeAgsOrThrow(
  lat: number,
  long: number,
): Promise<string | null> {
  try {
    const store = await contains(getSourceGateway(), "lau", { lat, lon: long });
    return gemeindeAgsFromContains(store);
  } catch (err) {
    if (err instanceof DerefError && (err.status === 404 || err.status === 410)) {
      return null; // definitive absence: the point is outside the layer's coverage
    }
    throw err;
  }
}

/**
 * The bare AGS from a region concept's `dcterms:identifier` in `store`. Defensively
 * strips a `<CC>_` GISCO country prefix (so it reads the bare AGS whether the wrapper
 * serves `"09564000"` or the legacy `"DE_09564000"` form). Subject-agnostic: takes the
 * first `dcterms:identifier` literal, which on a dereferenced concept is the concept's.
 * Pure.
 */
export function regionAgsFromConcept(store: Store): string | null {
  for (const q of store.getQuads(null, DCTERMS_IDENTIFIER, null, null)) {
    const v = q.object.value.replace(/^[A-Z]{2}_/, "").trim();
    if (v) return v;
  }
  return null;
}

/**
 * Resolve a region concept IRI (a building's `dcterms:spatial` object) to its bare AGS
 * by **dereferencing the concept and reading its `dcterms:identifier`** — the
 * authoritative literal the wrapper serves. Generalises to NUTS (whose IRI is a NUTS
 * code, not an AGS). Best-effort: `null` when unreachable or the concept has no
 * identifier. The RAW deref — the React Query `["regionAgs", iri]` entry IS the cache
 * (used as the `queryFn` by the map/regional hooks); non-reactive readers use
 * {@link fetchRegionAgsShared}.
 */
export async function fetchRegionAgs(conceptIri: string): Promise<string | null> {
  try {
    const store = await deref(getSourceGateway(), conceptIri, "region-identifier");
    return regionAgsFromConcept(store);
  } catch {
    return null; // best-effort: concept unreachable → no region
  }
}

/**
 * {@link fetchRegionAgs} read **once** through the warm React Query cache when the app is
 * mounted (`ensureQueryData` on `["regionAgs", iri]` — the same entry the map's choropleth
 * fills), else a direct deref (headless / unit). Region AGS is immutable, so `staleTime:
 * Infinity`. For non-hook readers (the aggregation compute's region resolver).
 */
export function fetchRegionAgsShared(conceptIri: string): Promise<string | null> {
  const qc = getAppQueryClient();
  if (!qc) return fetchRegionAgs(conceptIri);
  return qc.ensureQueryData({
    queryKey: [...sourceKeys.regionAgs, conceptIri],
    queryFn: () => fetchRegionAgs(conceptIri),
    staleTime: Infinity,
  });
}

/** A region match from a geo wrapper's `/search` (a lean SKOS concept). */
export interface RegionMatch {
  /** The region concept IRI (`…/nuts/{code}#it` or `…/lau/{giscoId}#it`). */
  iri: string;
  /** `skos:notation` — the NUTS code (`DE254`) or LAU GISCO_ID (`DE_09562000`). */
  notation: string;
  /** The 8-digit German AGS, for a LAU GISCO_ID (`DE_09562000` → `09562000`);
   *  "" for a NUTS code (whose digits are not an AGS). Drives `/filter?ags=`. */
  ags: string;
  label: string;
}

/** Parse the lean SKOS concepts of a `/search` response into region matches. */
export function parseRegionMatches(store: Store): RegionMatch[] {
  const out: RegionMatch[] = [];
  for (const q of store.getQuads(null, `${SKOS_NS}notation`, null, null)) {
    const notation = q.object.value;
    // A LAU GISCO_ID is `CC_<digits>`; its digits are the AGS. A NUTS code
    // (`DE254`) has no clean AGS, so leave it empty.
    const lau = notation.match(/^[A-Z]{2}_(\d+)$/);
    const label =
      store.getObjects(q.subject, `${SKOS_NS}prefLabel`, null)[0]?.value ?? "";
    out.push({
      iri: q.subject.value,
      notation,
      ags: lau ? lau[1] : "",
      label,
    });
  }
  return out;
}

/** Collect the finite [lon, lat] pairs of a GeoJSON coordinates array (any nesting). */
function collectPositions(coords: unknown, out: [number, number][]): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      out.push([coords[0], coords[1]]);
    }
    return;
  }
  for (const c of coords) collectPositions(c, out);
}

/**
 * Geocode a PLACE name (a municipality) to a map centre via the **linked-lau name
 * search** — the addressapi geocoder is structured (full addresses only), so a
 * place search resolves through the region classification instead. The search
 * serves the matching Gemeinden as GeoJSON; the first match's bbox centre is the
 * recentre point. Best-effort: `null` on a miss or error.
 */
export async function geocodePlace(
  name: string,
): Promise<{ lat: string; long: string } | null> {
  try {
    const url = `${sourceBase("lau")}${LAU_ROUTES.search}?q=${encodeURIComponent(name)}`;
    // GeoJSON, not RDF — a non-vocabulary read via the gateway's bare fetch.
    const res = await getSourceGateway().fetch(
      url,
      { headers: { Accept: "application/geo+json" } },
      "place search",
    );
    if (!res.ok) return null;
    const fc = await res.json() as { features?: { geometry?: { coordinates?: unknown } }[] };
    const pos: [number, number][] = [];
    collectPositions(fc.features?.[0]?.geometry?.coordinates, pos);
    if (pos.length === 0) return null;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [lon, lat] of pos) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    return { lat: String((s + n) / 2), long: String((w + e) / 2) };
  } catch {
    return null;
  }
}

/**
 * Keyword-search the NUTS or LAU classification by region code/name, returning
 * the matching region concepts — the discovery half of the exploration path
 * (`searchRegions("lau", "erlangen")` → its AGS → `fetchInstallationsByAgs`).
 * Best-effort: a non-OK response → `[]`.
 */
export async function searchRegions(
  source: "nuts" | "lau",
  q: string,
  params: Record<string, string | number> = {},
): Promise<RegionMatch[]> {
  try {
    const store = await search(getSourceGateway(), source, q, params);
    return parseRegionMatches(store);
  } catch {
    return [];
  }
}
