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
import { trackedFetch } from "../lib/networkActivity.ts";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { SKOS_NS } from "./rdf/vocabularies.ts";

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

/** Base URI of a wrapper (CORS-enabled — fetched directly, no dev proxy). Read
 *  lazily so importing this module for the pure test never touches
 *  `import.meta.env`. Mirrors `regionalstatistikBase()`. */
function wrapperBase(envKey: string, fallback: string): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[envKey] || fallback;
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
    const base = wrapperBase("VITE_LAU_API_URI", "https://wunderfacts.com/lau/");
    if (scope?.parent) return `${base}geojson?parent=${encodeURIComponent(scope.parent)}`;
    if (scope?.bbox) return `${base}geojson?bbox=${encodeURIComponent(scope.bbox)}`;
    throw new Error("gemeinde geometry requires a parent Kreis or a bbox");
  }
  const base = wrapperBase("VITE_NUTS_API_URI", "https://wunderfacts.com/nuts/");
  const level = grain === "land" ? 1 : 3;
  return `${base}geojson?level=${level}&parent=DE`;
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
  const url = regionGeometryUrl(grain, scope);
  const res = await trackedFetch(
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
  const base = wrapperBase("VITE_LAU_API_URI", "https://wunderfacts.com/lau/");
  return `${base}contains?lat=${lat}&lon=${long}`;
}

/**
 * The national (NUTS-0 `DE`, "Deutschland") region concept IRI — the catch-all extent for an
 * aggregation whose members span several Bundesländer (so they share no Land-or-finer AGS). It's a
 * NUTS concept, not an AGS one: AGS has no national code (it starts at the 2-digit Land), so this
 * references the linked-nuts `DE` `skos:Concept` rather than the `…/ags/{code}` scheme the finer
 * levels use. There is no national choropleth polygon, so this never shades on the Kreis/Land map.
 */
export function nationalRegionUrl(): string {
  const base = wrapperBase("VITE_NUTS_API_URI", "https://wunderfacts.com/nuts/");
  return `${base}nuts/DE#it`;
}

/**
 * The 8-digit Gemeinde AGS from a linked-lau `/contains` SKOS response, or `null` when nothing
 * contains the point. The wrapper returns the containing Gemeinde as a `skos:Concept` whose
 * `skos:notation` is the AGS prefixed `DE_` (e.g. `"DE_09564000"`); we strip non-digits and keep
 * the entry that yields exactly 8 (the Gemeinde — coarser NUTS concepts, if present, notate as
 * `DE25`/`DE254`, which don't). Pure.
 */
export function gemeindeAgsFromContains(turtle: string, baseIri: string): string | null {
  const store = parseRdfText(turtle, baseIri);
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
  const url = regionContainsUrl(lat, long);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "region contains (LAU)",
  );
  if (!res.ok) return null;
  return gemeindeAgsFromContains(await res.text(), url);
}
