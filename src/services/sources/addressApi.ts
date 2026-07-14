/**
 * Pure helpers for `linked-addressapi` (the GISCO Address API wrapper at
 * `sourceBase("addressapi")`) — request-shaping and response-parsing only, no
 * fetching, so both the app's geocoder (`geocode.ts`) and the logistikimmobilien
 * pipeline share ONE definition of the wrapper's quirks.
 *
 * The addressapi is a STRUCTURED geocoder, not a free-text one: `search` takes
 * the address split into `road` / `housenumber` plus `postcode` or `city`,
 * matched against the register's canonical upper-cased — and, for
 * municipalities, often abbreviated — spellings. Prefer `postcode` (it
 * sidesteps the spelling problem entirely); the city helpers below normalise
 * toward the register's forms for the postcode-less fallback.
 *
 * (The wrapper serves no `/routes` manifest, so unlike linked-mastr/-lau/… there
 * is no generated compile-time route contract; the route literals live here.)
 */

/** The two LIDS query routes the app/pipeline call (read as `.json`). */
export const ADDRESSAPI_ROUTES = {
  search: "search",
  reverse: "reverse",
} as const;

/**
 * Splits a street address ("Rother Straße 1 a") into the road / housenumber
 * parts the structured search wants. Greedy on the road so a numbered street
 * name stays whole ("Straße des 17. Juni 5" → road "Straße des 17. Juni",
 * housenumber "5"). Undefined without a house number — a road-only search
 * returns the whole street.
 */
export function splitStreetAddress(
  streetAddress: string | undefined,
): { road: string; housenumber: string } | undefined {
  const m = streetAddress?.match(/^(.*[^\s\d])\s+(\d.*)$/);
  if (!m) return undefined;
  return { road: m[1], housenumber: m[2] };
}

/**
 * Normalise a city/municipality name toward the register's spelling: upper-case,
 * single-spaced, abbreviation dots tightened ("Neunkirchen a. Sand" →
 * "NEUNKIRCHEN A.SAND", "Röthenbach a. d. Pegnitz" → "RÖTHENBACH A.D.PEGNITZ").
 * Spelled-out prepositions are left alone — the register is inconsistent there
 * ("FRANKFURT AM MAIN" spelled out, "NEUNKIRCHEN A.BRAND" abbreviated), so try
 * this form first and {@link abbreviateRegisterCity} as the retry.
 */
export function normalizeRegisterCity(city: string): string {
  return city
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    // "A. D. PEGNITZ" / "A.D. PEGNITZ" → "A.D.PEGNITZ"; "B. NÜRNBERG" → "B.NÜRNBERG"
    .replace(/\b([AB])\.\s*D\.\s*/g, "$1.D.")
    .replace(/\b([ABI])\.\s+/g, "$1.");
}

/**
 * The abbreviated-preposition variant of an (already {@link normalizeRegisterCity}
 * normalised) city name — the register's OTHER convention: " AN DER " → " A.D.",
 * " BEI " → " B.", " AM " / " AN " → " A.", " IM " → " I.". Returns the input
 * unchanged when nothing abbreviates; callers retry with this only when it
 * differs from the normalised form.
 */
export function abbreviateRegisterCity(cityUpper: string): string {
  return cityUpper
    .replace(/ AN DER /g, " A.D.")
    .replace(/ BEI /g, " B.")
    .replace(/ AM /g, " A.")
    .replace(/ AN /g, " A.")
    .replace(/ IM /g, " I.");
}

/** One `search`/`reverse` result: the register's address point + postal parts
 * (served upper-case, e.g. thoroughfare "ROTHER STRASSE"). */
export interface AddressApiHit {
  lat: number;
  lon: number;
  thoroughfare?: string;
  locatorDesignator?: string;
  postCode?: string;
  postName?: string;
}

/** Parses a `search`/`reverse` JSON response into its hits (results without a
 * finite coordinate are dropped). `reverse` serves the ~5 nearest, nearest first. */
export function parseAddressApiResults(json: unknown): AddressApiHit[] {
  const j = json as { results?: Partial<AddressApiHit>[] };
  const out: AddressApiHit[] = [];
  for (const r of j?.results ?? []) {
    if (typeof r?.lat !== "number" || typeof r?.lon !== "number") continue;
    out.push({
      lat: r.lat,
      lon: r.lon,
      thoroughfare: r.thoroughfare || undefined,
      locatorDesignator: r.locatorDesignator || undefined,
      postCode: r.postCode || undefined,
      postName: r.postName || undefined,
    });
  }
  return out;
}

/**
 * Parses a `search` response into the register's address point. Only an
 * UNAMBIGUOUS hit counts (`count === 1`): the point stands in for a whole
 * address, and a multi-hit (road-level) result would be an arbitrary neighbour.
 */
export function parseAddressApiPoint(
  json: unknown,
): { lat: number; lon: number } | undefined {
  if ((json as { count?: number })?.count !== 1) return undefined;
  const r = parseAddressApiResults(json)[0];
  return r ? { lat: r.lat, lon: r.lon } : undefined;
}

/**
 * The register's upper-case street spelling ("ROTHER STRASSE") restored to
 * display case ("Rother Straße"): title-case per word (hyphen-aware), with the
 * German-register-safe "strasse" → "straße" replacement (the register drops ß;
 * in German street names "strasse" is always ß). Heuristic — other ss/ß
 * ambiguities are left as served.
 */
export function displayCaseRegisterStreet(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-.])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
    .replace(/([Ss])trasse\b/g, "$1traße");
}
