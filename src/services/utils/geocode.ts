import { type GeocodePrecision } from "./vocabularies.ts";
import { trackedFetch } from "./networkActivity.ts";
import { logError } from "./logError.ts";

/**
 * Resolve building address fields to coordinates via Nominatim, returning the
 * lat/long and the *precision* a hit implies (so an approximately-placed building
 * — only its city resolved — is distinguishable from a rooftop match).
 *
 * Tries progressively coarser queries (full street → postcode + city → city), so
 * a too-precise house number a geocoder can't place still yields an approximate
 * pin. Returns null when nothing resolves. Throttled to Nominatim's ≤1 req/s, but
 * only paid on a miss — a first-try hit (the common case) adds no delay.
 */
export async function geocodeFields(
  fields: Record<string, string>,
): Promise<{ lat: string; long: string; precision: GeocodePrecision } | null> {
  const street = fields.streetAddress?.trim();
  const postal = fields.postalCode?.trim();
  const city = fields.locality?.trim();
  const region = fields.region?.trim();
  // Progressively coarser candidates, each tagged with the precision a hit
  // implies — included only when its distinguishing field is present.
  const candidates: Array<{ precision: GeocodePrecision; parts: (string | undefined)[] }> = [];
  if (street) candidates.push({ precision: "address", parts: [street, postal, city, region] });
  if (postal) candidates.push({ precision: "postcode", parts: [postal, city, region] });
  if (city) candidates.push({ precision: "city", parts: [city, region] });

  const tried = new Set<string>();
  let first = true;
  for (const { precision, parts } of candidates) {
    const query = parts.filter(Boolean).join(", ");
    if (!query || tried.has(query)) continue; // skip a coarsening that didn't change the query
    tried.add(query);
    // Space retries to respect Nominatim's ≤1 req/s policy (only paid on a miss;
    // a first-try hit — the common case — adds no delay).
    if (!first) await new Promise((r) => setTimeout(r, 1100));
    first = false;
    try {
      const res = await trackedFetch(
        `https://nominatim.openstreetmap.org/search?q=${
          encodeURIComponent(query)
        }&format=json&limit=1`,
        { headers: { "User-Agent": "Granergize/1.0 (thomas.wehr@fau.de)" } },
        "geocode address",
      );
      const data = await res.json() as { lat: string; lon: string }[];
      if (data.length) return { lat: data[0].lat, long: data[0].lon, precision };
    } catch (err) {
      logError("geocode address candidate", err);
      // Try the next, coarser query.
    }
  }
  return null;
}
