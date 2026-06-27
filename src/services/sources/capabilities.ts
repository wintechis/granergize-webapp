/**
 * The capability vocabulary of `sources/README.md`, executable over a
 * {@link SourceGateway}. Each helper builds the wrapper URL per the documented
 * grammar, fetches Turtle through the gateway, and parses to an n3 `Store`. The
 * per-source modules become thin parsers over these helpers instead of each
 * re-encoding the URL grammar and owning transport.
 *
 * - `deref(gw, iri)` — GET an absolute IRI (every source is dereferenceable).
 * - `search(gw, source, q, params?)` — `/search?q=` keyword discovery.
 * - `bbox(gw, source, box, params?)` — `/bbox?bbox=W,S,E,N` spatial area.
 * - `point(gw, source, p)` — `/point?lon=&lat=&r=` spatial point + radius.
 * - `contains(gw, source, p)` — `/contains?lat=&lon=` point → containing region.
 * - `filter(gw, source, attrs)` — `/filter?{attrs}` by-attribute selection.
 *
 * Discovery helpers assert the source declares the verb (the registry
 * `capabilities`), so a wrong source+verb pairing fails loudly rather than 404s.
 * Non-vocabulary reads (Nominatim JSON, the `geojson` bulk feed, a Commons image
 * blob) bypass these and use `gw.fetch` directly.
 */
import type { Store } from "n3";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
import type { SourceGateway } from "./sourceGateway.ts";
import {
  type SourceCapability,
  type SourceId,
  sourceCapabilities,
} from "../../constants/dataSources.ts";

/** A bounding box in WGS84 decimal degrees (west, south, east, north). */
export interface Box {
  w: number;
  s: number;
  e: number;
  n: number;
}

type Param = string | number | undefined;

/** Build a `?key=value` query string, URL-encoding values; arrays repeat the
 *  key; `undefined`/empty values are dropped. */
function query(params: Record<string, Param | Param[]>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v === undefined || v === "") {
        continue;
      }
      parts.push(`${key}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function assertCapability(source: SourceId, verb: SourceCapability): void {
  if (!sourceCapabilities(source).includes(verb)) {
    throw new Error(
      `source "${source}" does not serve /${verb} (capabilities: ` +
        `${sourceCapabilities(source).join(", ") || "none"})`,
    );
  }
}

/** GET `path` (relative to the source base) as Turtle → a `Store` based at the
 *  document IRI, so relative IRIs resolve to absolutes. */
async function fetchRdf(
  gw: SourceGateway,
  source: SourceId,
  path: string,
  label: string,
): Promise<Store> {
  const url = gw.baseOf(source) + path;
  return await derefUrl(gw, url, label);
}

async function derefUrl(
  gw: SourceGateway,
  url: string,
  label: string,
): Promise<Store> {
  const res = await gw.fetch(url, { headers: { Accept: "text/turtle" } }, label);
  if (!res.ok) {
    throw new Error(`${label}: ${res.status} for ${url}`);
  }
  return parseRdfText(await res.text(), url);
}

/** Dereference an absolute IRI to its RDF (follow-your-nose, one hop). */
export function deref(
  gw: SourceGateway,
  iri: string,
  label = "deref",
): Promise<Store> {
  return derefUrl(gw, iri, label);
}

/** `/search?q=` keyword discovery; extra `params` (e.g. `level`, `country`,
 *  `count`) are appended. */
export async function search(
  gw: SourceGateway,
  source: SourceId,
  q: string,
  params: Record<string, Param> = {},
): Promise<Store> {
  assertCapability(source, "search");
  return fetchRdf(gw, source, `search${query({ q, ...params })}`, `search ${source}`);
}

/** `/bbox?bbox=W,S,E,N` spatial-area discovery; extra `params` (e.g. `count`,
 *  `q`) are appended. */
export async function bbox(
  gw: SourceGateway,
  source: SourceId,
  box: Box,
  params: Record<string, Param> = {},
): Promise<Store> {
  assertCapability(source, "bbox");
  // Keep the commas literal (W,S,E,N) — matches the wrappers' grammar and the
  // existing modules / e2e route patterns; numeric, so no encoding is needed.
  const bboxStr = `${box.w},${box.s},${box.e},${box.n}`;
  const extra = query(params);
  const path = `bbox?bbox=${bboxStr}${extra ? `&${extra.slice(1)}` : ""}`;
  return fetchRdf(gw, source, path, `bbox ${source}`);
}

/** `/point?lon=&lat=&r=` spatial point + radius (metres) discovery. */
export async function point(
  gw: SourceGateway,
  source: SourceId,
  p: { lon: number; lat: number; r: number },
): Promise<Store> {
  assertCapability(source, "point");
  return fetchRdf(
    gw,
    source,
    `point${query({ lon: p.lon, lat: p.lat, r: p.r })}`,
    `point ${source}`,
  );
}

/** `/contains?lat=&lon=` point → containing region(s); extra `params` (e.g.
 *  `level`, `relation`) are appended. */
export async function contains(
  gw: SourceGateway,
  source: SourceId,
  p: { lat: number; lon: number },
  params: Record<string, Param> = {},
): Promise<Store> {
  assertCapability(source, "contains");
  return fetchRdf(
    gw,
    source,
    `contains${query({ lat: p.lat, lon: p.lon, ...params })}`,
    `contains ${source}`,
  );
}

/** `/filter?{attrs}` by-attribute selection (exact facets; arrays repeat the
 *  key, e.g. `{ carrier: ["2495", "2957"] }`). */
export async function filter(
  gw: SourceGateway,
  source: SourceId,
  attrs: Record<string, Param | Param[]>,
): Promise<Store> {
  assertCapability(source, "filter");
  return fetchRdf(gw, source, `filter${query(attrs)}`, `filter ${source}`);
}
