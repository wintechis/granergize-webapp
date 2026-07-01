/**
 * Read `linked-mastr` (the German Marktstammdatenregister) as Linked Data: the
 * renewable-energy installations *around a building's coordinates*. The wrapper's
 * `<base>within?bbox=W,S,E,N` serves one RDF resource per generation unit
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
import { DCTERMS_NS, GEO_LAT, GEO_LONG, RDFS_NS } from "../rdf/vocabularies.ts";
import type { Store } from "n3";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { type Box, deref, filter, within } from "./capabilities.ts";

const RDFS_LABEL = `${RDFS_NS}label`;
const DCTERMS_SPATIAL = `${DCTERMS_NS}spatial`;
/** Matched by suffix so it is independent of the (configurable) wrapper base. */
const ENERGIETRAEGER_SUFFIX = "#Energietraeger";
const EEG_MASTR_NR_SUFFIX = "#EegMaStRNummer";
const BRUTTOLEISTUNG_SUFFIX = "#Bruttoleistung";
const GEMEINDE_SUFFIX = "#Gemeinde";

/** The renewable kind for an Energieträger value — a bare code (`"2495"`, the lean bbox)
 *  or a catalog IRI (`…/cl/148#2495`, the per-unit deref); null if not a renewable. */
function carrierKind(value: string): InstallationKind | null {
  const code = value.includes("#") ? value.split("#").pop()! : value;
  return RENEWABLE_CARRIER[code] ?? null;
}

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
  /** Great-circle distance from the query point, in kilometres — present for the
   *  nearby (point-anchored) read, omitted for the by-AGS (region) read. */
  distanceKm?: number;
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

/** The WGS84 bounding box of half-width `radiusKm` around a point (~111 km per
 *  degree latitude; longitude shrinks by cos). Shared by the fetch and the
 *  dev-link IRI so they can't diverge. */
function boxAround(lat: number, long: number, radiusKm: number): Box {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { w: long - dLon, s: lat - dLat, e: long + dLon, n: lat + dLat };
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
 * Parse the renewable installations from a `bbox`/`filter` listing `Store`
 * (no query point). Pure — the network-free half, unit-tested with a fixture. A
 * unit is kept only when it has coordinates and a recognised renewable carrier
 * code. Order is the Store's; the nearby variant sorts by distance.
 */
export function parseInstallations(store: Store): NearbyInstallation[] {
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
      out.push({ iri: subject.value, label, kind, lat, long, ags });
    }
  }
  return out;
}

/**
 * As {@link parseInstallations}, but anchored to a query point: each unit gets a
 * `distanceKm` and the list is sorted nearest-first.
 */
export function parseNearbyInstallations(
  store: Store,
  fromLat: number,
  fromLong: number,
): NearbyInstallation[] {
  return parseInstallations(store)
    .map((u) => ({ ...u, distanceKm: haversineKm(fromLat, fromLong, u.lat, u.long) }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}

/** The `within` (bbox) query IRI for a point — the Developer-mode source link (matches what
 *  {@link fetchNearbyInstallations} fetches through the gateway). */
export function nearbyInstallationsUrl(
  lat: number,
  long: number,
  radiusKm = DEFAULT_RADIUS_KM,
): string {
  const b = boxAround(lat, long, radiusKm);
  return `${sourceBase("mastr")}within?bbox=${b.w},${b.s},${b.e},${b.n}&count=${FETCH_CAP}`;
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
  const store = await within(
    getSourceGateway(),
    "mastr",
    boxAround(lat, long, radiusKm),
    { count: FETCH_CAP },
  );
  return parseNearbyInstallations(store, lat, long).slice(0, limit);
}

/**
 * The renewable installations IN a region by AGS prefix (2-digit Land / 5-digit
 * Kreis / 8-digit Gemeinde) — the exploration counterpart of
 * {@link fetchNearbyInstallations} with no query point (so no distance/sort).
 * Pairs with the geo wrappers' `/search`: resolve a place name to a region, take
 * its AGS, list its units. Throws on a non-OK response.
 */
export async function fetchInstallationsByAgs(
  ags: string,
  opts: { limit?: number } = {},
): Promise<NearbyInstallation[]> {
  const store = await filter(getSourceGateway(), "mastr", { ags, count: FETCH_CAP });
  const units = parseInstallations(store);
  return opts.limit != null ? units.slice(0, opts.limit) : units;
}

/** The trailing plant number from a `…/eeg/{number}#it` IRI (the netztransparenz key),
 *  or null. The IRI is relative to the MaStR host — we want only the number, to build
 *  the netztransparenz IRI, NOT follow it to the mastr host. */
export function eegNumberFromIri(iri: string): string | null {
  const m = iri.match(/\/eeg\/(\d+)/);
  return m ? m[1] : null;
}

/** Pure: the EEG plant number a unit `Store` declares via `mastr:EegMaStRNummer`, or
 *  null — non-EEG units (e.g. combustion) omit the predicate. The network-free half of
 *  {@link fetchEegNumber}, unit-tested with a fixture. */
export function parseEegNumber(store: Store): string | null {
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.predicate.value.endsWith(EEG_MASTR_NR_SUFFIX)) {
      return eegNumberFromIri(q.object.value);
    }
  }
  return null;
}

/** A renewable unit's master data, parsed from its dereferenced `…/see/{id}` document —
 *  for the open-observation detail (richer than the lean bbox listing). */
export interface UnitDetail {
  label: string;
  kind: InstallationKind | null;
  /** Gross capacity [kW] (`mastr:Bruttoleistung`), or null. */
  capacityKw: number | null;
  /** Municipality (`mastr:Gemeinde`), or "". */
  locality: string;
  /** The EEG plant number (`mastr:EegMaStRNummer`) for the netztransparenz join, or null. */
  eegNumber: string | null;
}

/** Pure: parse a unit `Store`'s master data (label, capacity, kind, locality, EEG
 *  number). One pass over the quads; missing fields default. */
export function parseUnitDetail(store: Store): UnitDetail {
  let label = "", locality = "", capacityKw: number | null = null;
  let kind: InstallationKind | null = null, eegNumber: string | null = null;
  for (const q of store.getQuads(null, null, null, null)) {
    const p = q.predicate.value;
    if (p === RDFS_LABEL) label = q.object.value;
    else if (p.endsWith(BRUTTOLEISTUNG_SUFFIX)) {
      const n = Number.parseFloat(q.object.value);
      if (!Number.isNaN(n)) capacityKw = n;
    } else if (p.endsWith(GEMEINDE_SUFFIX)) locality = q.object.value;
    else if (p.endsWith(ENERGIETRAEGER_SUFFIX)) kind = carrierKind(q.object.value);
    else if (p.endsWith(EEG_MASTR_NR_SUFFIX)) {
      eegNumber = eegNumberFromIri(q.object.value);
    }
  }
  return { label, kind, capacityKw, locality, eegNumber };
}

/**
 * Dereference a unit (`…/see/{id}#it`) and read its EEG plant number — the key that
 * joins into `linked-netztransparenz` for the plant's settled generation. Best-effort:
 * a non-OK response, or a non-EEG unit, → null (the open layer degrades quietly). This
 * is the second deref of the join (after the bbox listing), accepted per the plan.
 */
export async function fetchEegNumber(
  installationIri: string,
): Promise<string | null> {
  const docUri = installationIri.split("#")[0]; // …/see/{id}
  try {
    const store = await deref(
      getSourceGateway(),
      docUri,
      "installation detail (MaStR)",
    );
    return parseEegNumber(store);
  } catch {
    return null; // best-effort: a down/404 unit drops out quietly
  }
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
