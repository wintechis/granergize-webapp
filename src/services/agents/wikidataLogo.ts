/**
 * Best-effort enrichment: resolve an org's logo from Wikidata when its Pod
 * profile carries no `foaf:logo` but does link out to a Wikidata entity via
 * `owl:sameAs`. Reads the entity's "logo image" (P154, falling back to "image"
 * P18) claim — a Wikimedia Commons filename — and renders it through Commons'
 * `Special:FilePath`, which redirects to the real file (an `<img src>` then
 * loads it cross-origin without CORS).
 *
 * Pure + injectable (takes its own `fetchFn`) so it's unit-testable offline,
 * and never throws: any non-Wikidata IRI, missing claim, or fetch/JSON error
 * resolves to `undefined`.
 */

/** Wikidata's EntityData JSON endpoint sends `Access-Control-Allow-Origin: *`. */
const ENTITY_DATA_BASE = "https://www.wikidata.org/wiki/Special:EntityData/";
/** Commons `Special:FilePath` redirects a filename to the actual image file. */
const COMMONS_FILEPATH_BASE =
  "https://commons.wikimedia.org/wiki/Special:FilePath/";
/** "logo image" — preferred; "image" — generic fallback. */
const P_LOGO = "P154";
const P_IMAGE = "P18";

/**
 * Extract a Wikidata entity id (`Q…`) from an IRI, or `undefined` for a
 * non-Wikidata / non-entity IRI. Accepts both the canonical entity form
 * (`http(s)://www.wikidata.org/entity/Q42`) and the human page form
 * (`…/wiki/Q42`).
 */
export function wikidataEntityId(iri: string): string | undefined {
  const m = iri.match(
    /^https?:\/\/(?:www\.)?wikidata\.org\/(?:entity|wiki)\/(Q\d+)/,
  );
  return m ? m[1] : undefined;
}

/** First Commons filename in the entity's P154 (else P18) claims, if any. */
function commonsFilenameFromClaims(
  claims: unknown,
): string | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  const byProp = claims as Record<string, unknown>;
  for (const prop of [P_LOGO, P_IMAGE]) {
    const statements = byProp[prop];
    if (!Array.isArray(statements)) continue;
    for (const st of statements) {
      const value = (st as { mainsnak?: { datavalue?: { value?: unknown } } })
        ?.mainsnak?.datavalue?.value;
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

/**
 * Resolve a logo image IRI for a Wikidata entity IRI, or `undefined`. Performs
 * NO fetch for a non-Wikidata IRI. Best-effort — swallows every error.
 * @operation query
 */
export async function fetchWikidataLogo(
  iri: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const id = wikidataEntityId(iri);
  if (!id) return undefined;
  try {
    const res = await fetchFn(`${ENTITY_DATA_BASE}${id}.json`);
    if (!res.ok) return undefined;
    const json = await res.json();
    const entity = (json as { entities?: Record<string, unknown> })
      ?.entities?.[id];
    const claims = (entity as { claims?: unknown })?.claims;
    const filename = commonsFilenameFromClaims(claims);
    if (!filename) return undefined;
    return `${COMMONS_FILEPATH_BASE}${encodeURIComponent(filename)}`;
  } catch {
    return undefined;
  }
}
