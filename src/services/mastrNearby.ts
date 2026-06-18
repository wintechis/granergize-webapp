/**
 * Read `linked-mastr` (the German Marktstammdatenregister) as Linked Data: the
 * renewable-energy installations *around a building's coordinates*. The wrapper's
 * `<base>bbox?bbox=W,S,E,N` serves one RDF resource per generation unit
 * (`<…/see/{id}#it>`), each carrying `rdfs:label`, WGS84 `geo:lat`/`geo:long`,
 * `dcterms:spatial …/ags/{8-digit}` (its municipality) and `mastr:Energietraeger`
 * (a MaStR energy-carrier CODE). We classify the carrier code into a renewable
 * technology kind and keep the nearest units.
 *
 * This is the FINEST-grain place layer — individual installations, the
 * per-building analogue of the nearest weather station — and the sibling of the
 * coarser Bundesland/Kreis regional-statistics layer (`regionalCube.ts`). It also
 * yields the building's Kreis (the first 5 digits of a nearby unit's AGS), the
 * reverse-geocode the regional layer needs for its Kreis-grain tables (there is no
 * point-in-polygon endpoint in the geo wrappers).
 *
 * Off-Pod and queried — reached through {@link trackedFetch} so it shows in the
 * global loading indicator and retries transient throttling. The parse is split
 * out pure for offline unit-testing.
 *
 * Caveat: the lean bbox listing carries no capacity and no `rdf:type`; the kind is
 * inferred from the carrier code, which is reliable for the dominant top-level
 * renewables (solar/wind/hydro/biomass). Per-unit Bruttoleistung and authoritative
 * `vocab:#…Unit` typing would need a follow-up deref of each `…/see/{id}` record.
 */
import { GEO_LAT, GEO_LONG, DCTERMS_NS, RDFS_NS } from "./rdf/vocabularies.ts";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { trackedFetch } from "../lib/networkActivity.ts";

const RDFS_LABEL = `${RDFS_NS}label`;
const DCTERMS_SPATIAL = `${DCTERMS_NS}spatial`;
/** Matched by suffix so it is independent of the (configurable) wrapper base. */
const ENERGIETRAEGER_SUFFIX = "#Energietraeger";

/** A renewable generation technology. */
export type InstallationKind = "solar" | "wind" | "hydro" | "biomass";

/**
 * Top-level MaStR Energieträger Katalogwert ids → renewable technology. These are
 * the carrier codes a generation unit's primary `mastr:Energietraeger` usually
 * carries (categories cl/146/148/150/151). Codes outside this set — combustion
 * sub-codes, nuclear, storage — are not renewable generation and are dropped.
 */
const RENEWABLE_CARRIER: Record<string, InstallationKind> = {
  "2493": "biomass", // Biomasse
  "2495": "solar", //   Solare Strahlungsenergie
  "2497": "wind", //    Wind
  "2498": "hydro", //   Wasser
};

/** One renewable installation near a building. */
export interface NearbyInstallation {
  /** The unit's IRI (`…/see/{id}#it`) — the Developer-mode source link. */
  iri: string;
  label: string;
  kind: InstallationKind;
  lat: number;
  long: number;
  /** The 8-digit municipality AGS from `dcterms:spatial` (Kreis = first 5). */
  ags: string;
  /** Great-circle distance from the query point, in kilometres. */
  distanceKm: number;
}

export interface NearbyOptions {
  /** Half-width of the search box, in kilometres (default 3). */
  radiusKm?: number;
  /** Max units to keep after sorting by distance (default 25). */
  limit?: number;
}

/** Half-width of the default search box around a building, in kilometres. */
export const DEFAULT_RADIUS_KM = 3;
const DEFAULT_LIMIT = 25;
/** Hard cap on the bbox listing the wrapper returns (a dense city is huge). */
const FETCH_CAP = 500;

/** Base URI of the linked-mastr wrapper (CORS-enabled; fetched directly). Read
 *  lazily so importing this module for the pure parser test never touches
 *  `import.meta.env` (same pattern as {@link regionalCube}). */
function mastrBase(): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_MASTR_API_URI || "https://wunderfacts.com/mastr/";
}

/** Great-circle distance between two WGS84 points, in kilometres. */
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

/** The `…/ags/{code}` IRI's trailing AGS digits, or "" if none. */
function agsFromSpatial(iri: string): string {
  const m = iri.match(/\/ags\/(\d+)/);
  return m ? m[1] : "";
}

/**
 * Parse a `bbox` Turtle document into the renewable installations near
 * (`fromLat`, `fromLong`), nearest first. Pure — the network-free half,
 * unit-tested with a fixture. A unit is kept only when it has coordinates and a
 * recognised renewable carrier code.
 */
export function parseNearbyInstallations(
  turtle: string,
  baseIri: string,
  fromLat: number,
  fromLong: number,
): NearbyInstallation[] {
  const store = parseRdfText(turtle, baseIri);
  const out: NearbyInstallation[] = [];
  // Subjects with a latitude are the units (the lean listing has no rdf:type).
  for (const latQuad of store.getQuads(null, GEO_LAT, null, null)) {
    const subject = latQuad.subject;
    const lat = Number.parseFloat(latQuad.object.value);
    let long: number | null = null;
    let label = "";
    let ags = "";
    let kind: InstallationKind | undefined;
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p === GEO_LONG) long = Number.parseFloat(q.object.value);
      else if (p === RDFS_LABEL) label = q.object.value;
      else if (p === DCTERMS_SPATIAL) ags = agsFromSpatial(q.object.value);
      else if (p.endsWith(ENERGIETRAEGER_SUFFIX)) {
        kind = RENEWABLE_CARRIER[q.object.value];
      }
    }
    if (kind && long != null && !Number.isNaN(lat) && !Number.isNaN(long)) {
      out.push({
        iri: subject.value,
        label,
        kind,
        lat,
        long,
        ags,
        distanceKm: haversineKm(fromLat, fromLong, lat, long),
      });
    }
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** The bbox query IRI for a point — fetched, and the Developer-mode source link. */
export function nearbyInstallationsUrl(
  lat: number,
  long: number,
  radiusKm = DEFAULT_RADIUS_KM,
): string {
  // Box around the point: ~111 km per degree latitude; longitude shrinks by cos.
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const w = long - dLon, s = lat - dLat, e = long + dLon, n = lat + dLat;
  const bbox = `${w},${s},${e},${n}`;
  return `${mastrBase()}bbox?bbox=${bbox}&count=${FETCH_CAP}`;
}

/**
 * Fetch + parse the renewable installations near a point, nearest first and
 * capped at `limit`. Throws on a non-OK response (the caller's query surfaces it).
 */
export async function fetchNearbyInstallations(
  lat: number,
  long: number,
  opts: NearbyOptions = {},
): Promise<NearbyInstallation[]> {
  const { radiusKm = DEFAULT_RADIUS_KM, limit = DEFAULT_LIMIT } = opts;
  const url = nearbyInstallationsUrl(lat, long, radiusKm);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "nearby installations (MaStR)",
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching nearby installations`);
  const all = parseNearbyInstallations(await res.text(), url, lat, long);
  return all.slice(0, limit);
}

/**
 * The building's Kreis AGS (5-digit), derived from the nearest installations'
 * municipality codes — the reverse-geocode for the Kreis-grain regional tables.
 * Uses the most frequent 5-digit prefix among the nearest units (robust to a lone
 * unit that sits just across a Kreis border), or `null` when none are known.
 */
export function kreisFromInstallations(
  installations: readonly NearbyInstallation[],
): string | null {
  const counts = new Map<string, number>();
  for (const u of installations) {
    if (u.ags.length >= 5) {
      const kreis = u.ags.slice(0, 5);
      counts.set(kreis, (counts.get(kreis) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [kreis, n] of counts) {
    if (n > bestN) {
      best = kreis;
      bestN = n;
    }
  }
  return best;
}

/**
 * The building's Gemeinde AGS (8-digit), derived the same way as
 * {@link kreisFromInstallations} but at municipality grain: the most frequent
 * 8-digit code among the nearest units (robust to a lone unit just across a
 * Gemeinde border), or `null` when none are known. The reverse-geocode the
 * per-Gemeinde Energie-Atlas layer needs — there is no point-in-polygon endpoint.
 */
export function gemeindeFromInstallations(
  installations: readonly NearbyInstallation[],
): string | null {
  const counts = new Map<string, number>();
  for (const u of installations) {
    if (u.ags.length === 8) {
      counts.set(u.ags, (counts.get(u.ags) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [ags, n] of counts) {
    if (n > bestN) {
      best = ags;
      bestN = n;
    }
  }
  return best;
}
