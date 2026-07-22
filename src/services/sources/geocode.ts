import { type GeocodePrecision } from "../rdf/vocabularies.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import {
  fetchContainingGemeindeAgs,
  fetchContainingGemeindeAgsOrThrow,
} from "./regionGeometry.ts";
import { logError } from "../../lib/logError.ts";
import {
  abbreviateRegisterCity,
  ADDRESSAPI_ROUTES,
  normalizeRegisterCity,
  parseAddressApiPoint,
  splitStreetAddress,
} from "./addressApi.ts";

/**
 * Resolve building address fields to coordinates via `linked-addressapi` (the
 * GISCO Address API wrapper — the European register of addresses, sourced from
 * the national cadastral registers; DE: BKG). A hit is the register's OWN point
 * for that address, so every resolution is `Address` precision — there is no
 * Nominatim-style coarsening any more: the addressapi is a STRUCTURED geocoder
 * (road + housenumber + postcode/city), and a partial address (no street, or no
 * postcode/city) simply doesn't geocode.
 *
 * Query strategy (first unambiguous hit wins):
 *   1. postcode-based — immune to the register's municipality spellings;
 *   2. city-based, the city normalised toward the register's form
 *      ({@link normalizeRegisterCity});
 *   3. city-based with spelled-out prepositions abbreviated
 *      ({@link abbreviateRegisterCity}: "Schwaig bei Nürnberg" → "SCHWAIG
 *      B.NÜRNBERG") — the register's other convention.
 *
 * Returns null when nothing resolves (or a query is road-level ambiguous).
 * Pure address→coords; {@link geocodeWithRegion} adds the region lookup on top.
 */
export async function geocodeFields(
  fields: Record<string, string>,
): Promise<{ lat: string; long: string; precision: GeocodePrecision } | null> {
  const parts = splitStreetAddress(fields.streetAddress?.trim());
  if (!parts) return null; // no road + housenumber → nothing to search for
  const postal = fields.postalCode?.trim();
  const city = fields.locality?.trim();

  // The register is queried per country (ISO2); the app's building stock and
  // region model (Gemeinde AGS) are German, so DE is fixed here.
  const base = `${sourceBase("addressapi")}${ADDRESSAPI_ROUTES.search}.json` +
    `?country=DE&road=${encodeURIComponent(parts.road)}` +
    `&housenumber=${encodeURIComponent(parts.housenumber)}`;
  const candidates: string[] = [];
  if (postal) candidates.push(`${base}&postcode=${encodeURIComponent(postal)}`);
  if (city) {
    const norm = normalizeRegisterCity(city);
    candidates.push(`${base}&city=${encodeURIComponent(norm)}`);
    const abbr = abbreviateRegisterCity(norm);
    if (abbr !== norm) {
      candidates.push(`${base}&city=${encodeURIComponent(abbr)}`);
    }
  }

  for (const url of candidates) {
    try {
      const res = await getSourceGateway().fetch(url, {}, "geocode address");
      // A failing wrapper (5xx after the transport's transient retries) must not
      // be read as "no match": falling through could mask an outage as a miss.
      // Give up instead — the building saves without coordinates, retryable.
      if (!res.ok) {
        logError(
          "geocode address",
          new Error(`geocode ${res.status} ${res.statusText}`),
        );
        return null;
      }
      const p = parseAddressApiPoint(await res.json());
      if (p) {
        return { lat: String(p.lat), long: String(p.lon), precision: "Address" };
      }
    } catch (err) {
      logError("geocode address candidate", err);
      // Try the next candidate spelling.
    }
  }
  return null;
}

/**
 * {@link geocodeFields} plus the building's **region** (8-digit Gemeinde AGS, via linked-lau
 * `/contains`) resolved from the fresh coordinates — so the region is captured ONCE at geocode
 * rather than reverse-geocoded on every later read. Best-effort: `regionAgs` is absent when the
 * point is outside the wrapper's coverage or the lookup fails. `null` when geocoding itself misses.
 */
export async function geocodeWithRegion(
  fields: Record<string, string>,
): Promise<
  { lat: string; long: string; precision: GeocodePrecision; regionAgs?: string } | null
> {
  const coords = await geocodeFields(fields);
  if (!coords) return null;
  return await withRegionAgs(coords);
}

/** The point→Gemeinde-AGS lookup {@link withRegionAgs} enriches through — the
 *  seed geocoder substitutes a latched variant. */
type AgsLookup = (lat: number, long: number) => Promise<string | null>;

/** Best-effort AGS enrichment of already-resolved coordinates (shared by
 *  {@link geocodeWithRegion} and {@link makeGeocodeOrAdoptCoords}). */
async function withRegionAgs<
  T extends { lat: string; long: string },
>(
  coords: T,
  lookupAgs: AgsLookup = fetchContainingGemeindeAgs,
): Promise<T & { regionAgs?: string }> {
  const regionAgs = await lookupAgs(
    parseFloat(coords.lat),
    parseFloat(coords.long),
  ).catch((err) => {
    logError("resolve region at geocode", err);
    return null;
  });
  return { ...coords, ...(regionAgs ? { regionAgs } : {}) };
}

/**
 * Build the demo-seed geocoder: like {@link geocodeWithRegion}, except fields
 * that already CARRY coordinates (the L.Immo extract ships lat/long) adopt them
 * instead of querying the address register; the region AGS is still resolved
 * from them. Not for the dialogs' "Geocode" button ({@link geocodeWithRegion}
 * there): an edited address with stale form coordinates must re-geocode, not
 * adopt.
 *
 * A factory, not a plain function, because the AGS lookup carries a per-run
 * LATCH: after one transport-level failure (linked-lau down — in the browser
 * each such attempt costs the full transient-retry backoff, ~50 s of network
 * `TypeError` retries) the remaining buildings of the run skip the lookup
 * instead of each paying it again. A definitive "no region contains the point"
 * (404) does not latch. Build one geocoder per seed run.
 */
export function makeGeocodeOrAdoptCoords(): (
  fields: Record<string, string>,
) => Promise<
  { lat: string; long: string; precision: GeocodePrecision; regionAgs?: string } | null
> {
  let agsUnavailable = false;
  const lookupAgs: AgsLookup = async (lat, long) => {
    if (agsUnavailable) return null;
    try {
      return await fetchContainingGemeindeAgsOrThrow(lat, long);
    } catch (err) {
      agsUnavailable = true;
      logError("resolve region at geocode (lookups off for this run)", err);
      return null;
    }
  };
  return async (fields) => {
    const lat = Number(fields.lat), long = Number(fields.long);
    if (!fields.lat?.trim() || !fields.long?.trim() || !Number.isFinite(lat) || !Number.isFinite(long)) {
      const coords = await geocodeFields(fields);
      if (!coords) return null;
      return await withRegionAgs(coords, lookupAgs);
    }
    return await withRegionAgs({
      lat: fields.lat,
      long: fields.long,
      precision: (fields.geocodePrecision as GeocodePrecision | undefined) ?? "Address",
    }, lookupAgs);
  };
}
