/**
 * Registry of the external data sources the app consumes. It carries two
 * concerns, co-located by id:
 *
 * - **Attribution** (the original job): the credits page (`pages/DataSources`)
 *   lists them all, and `components/SourceNote` cites individual ones under the
 *   panels/figures that use them. Names + licence tokens are proper nouns / short
 *   identifiers, not translated; the surrounding chrome goes through the message
 *   catalog. This is *legal* attribution — visible to all users, never dev-gated.
 * - **Transport** (for the `SourceGateway`): the wrapper/source `base` IRI, its
 *   env override key, and the capability verbs it serves. `sourceBase(id)`
 *   resolves the base runtime-agnostically (`import.meta.env` ?? `Deno.env` ??
 *   `base`), so the same resolver works in the browser, under Deno, and in tests.
 *
 * Source ids are the **canonical wrapper path segment** (`linked-{id}` /
 * `wunderfacts.com/{id}/`): `lod2-by` not `lod2`, `wetterdienst` not `dwd`, and
 * `nuts` / `lau` split (they are two wrappers with two bases). One entry per id,
 * mirroring the `sources/<id>.md` notes (overview in `sources/README.md`).
 */

/** The discovery/deref verbs a source serves — the `SourceGateway` capability
 *  helpers (`src/services/sources/capabilities.ts`). Non-RDF reads (Nominatim
 *  JSON, the `geojson` bulk feed, a Commons image blob) are not in this set;
 *  they go through the gateway's bare `fetch`. */
export type SourceCapability =
  | "deref"
  | "search"
  | "bbox"
  | "point"
  | "contains"
  | "filter";

/** Sources the `SourceGateway` fetches from, keyed by canonical wrapper-path id.
 *  Excludes the bundled/tile sources (pvgis, basemap, bavaria-dop), which the
 *  gateway never fetches. */
export type SourceId =
  | "mastr"
  | "lod2-by"
  | "nuts"
  | "lau"
  | "regionalstatistik"
  | "energieatlas"
  | "netztransparenz"
  | "wetterdienst"
  | "osm"
  | "wikidata"
  | "commons";

export interface DataSource {
  /** Stable id (matches the `sources/<id>.md` note; the wrapper path segment). */
  id: string;
  /** Display name (proper noun). */
  name: string;
  /** Homepage / data portal. */
  homepage?: string;
  /** Short licence token, e.g. "ODbL", "dl-de/by-2.0", "CC BY 4.0". */
  license?: string;
  /** Licence document URL. */
  licenseHref?: string;
  /** One-line description of what the app uses it for (credits page). */
  note: string;
  /** Env var overriding the base IRI (Vite `import.meta.env` or `Deno.env`). */
  envKey?: string;
  /** Base IRI the source is served at (CORS-direct); trailing slash. */
  base?: string;
  /** Discovery/deref verbs this source serves (the gateway capability helpers). */
  capabilities?: readonly SourceCapability[];
}

const DL_DE_BY = "https://www.govdata.de/dl-de/by-2-0";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";

/** Keyed for ergonomic citation: `SOURCES.osm`, `SOURCES["lod2-by"]`, … */
export const SOURCES = {
  osm: {
    id: "osm",
    name: "OpenStreetMap / Nominatim",
    homepage: "https://www.openstreetmap.org/copyright",
    license: "ODbL",
    licenseHref: "https://opendatacommons.org/licenses/odbl/1-0/",
    note: "Geocoding building addresses to coordinates.",
    envKey: "VITE_NOMINATIM_API_URI",
    base: "https://nominatim.openstreetmap.org/",
    // Nominatim search is JSON, not an RDF capability helper — see geocode.ts.
    capabilities: [],
  },
  mastr: {
    id: "mastr",
    name: "Marktstammdatenregister (MaStR)",
    homepage: "https://www.marktstammdatenregister.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Nearby energy installations (via linked-mastr).",
    envKey: "VITE_MASTR_API_URI",
    base: "https://wunderfacts.com/mastr/",
    capabilities: ["deref", "bbox", "search", "filter"],
  },
  netztransparenz: {
    id: "netztransparenz",
    name: "Netztransparenz (EEG-Jahresabrechnung)",
    homepage: "https://www.netztransparenz.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Actually-settled renewable generation per plant (via linked-netztransparenz).",
    envKey: "VITE_NETZTRANSPARENZ_API_URI",
    base: "https://wunderfacts.com/netztransparenz/",
    capabilities: ["deref"],
  },
  wetterdienst: {
    id: "wetterdienst",
    name: "Deutscher Wetterdienst (DWD)",
    homepage: "https://www.dwd.de/",
    license: "GeoNutzV",
    licenseHref: "https://www.dwd.de/EN/service/copyright/copyright_node.html",
    note: "Weather observations (via linked-wetterdienst).",
    envKey: "VITE_WEATHER_API_URI",
    base: "https://wunderfacts.com/wetterdienst/",
    // near/values are custom endpoints, not standard verbs — see linkedWeather.ts.
    capabilities: ["deref"],
  },
  regionalstatistik: {
    id: "regionalstatistik",
    name: "Regionalstatistik (GENESIS)",
    homepage: "https://www.regionalstatistik.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Regional statistics (via linked-regionalstatistik).",
    envKey: "VITE_REGIONALSTATISTIK_API_URI",
    base: "https://wunderfacts.com/regionalstatistik/",
    capabilities: ["deref"],
  },
  energieatlas: {
    id: "energieatlas",
    name: "Energie-Atlas Bayern",
    homepage: "https://www.energieatlas.bayern.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Municipal energy potential, Bavaria (via linked-energieatlas).",
    envKey: "VITE_LINKED_ENERGIEATLAS_API_URI",
    base: "https://wunderfacts.com/energieatlas/",
    capabilities: ["deref"],
  },
  "lod2-by": {
    id: "lod2-by",
    name: "LDBV LoD2-BY",
    homepage: "https://www.ldbv.bayern.de/",
    license: "CC BY 4.0",
    licenseHref: CC_BY_4,
    note: "3D roof geometry for rooftop-PV potential (via linked-lod2-by).",
    envKey: "VITE_LOD2_API_URI",
    base: "https://wunderfacts.com/lod2-by/",
    capabilities: ["deref", "point", "bbox"],
  },
  nuts: {
    id: "nuts",
    name: "Eurostat NUTS (GISCO)",
    homepage: "https://ec.europa.eu/eurostat/web/gisco",
    note: "Statistical region boundaries & hierarchy (via linked-nuts).",
    envKey: "VITE_NUTS_API_URI",
    base: "https://wunderfacts.com/nuts/",
    // geojson (bulk) is non-RDF — see regionGeometry.ts.
    capabilities: ["deref", "contains", "search"],
  },
  lau: {
    id: "lau",
    name: "Eurostat LAU (GISCO)",
    homepage: "https://ec.europa.eu/eurostat/web/gisco",
    note: "Local administrative units (Gemeinden) — boundaries & hierarchy (via linked-lau).",
    envKey: "VITE_LAU_API_URI",
    base: "https://wunderfacts.com/lau/",
    capabilities: ["deref", "contains", "search"],
  },
  wikidata: {
    id: "wikidata",
    name: "Wikidata",
    homepage: "https://www.wikidata.org/",
    license: "CC0",
    licenseHref: "https://creativecommons.org/publicdomain/zero/1.0/",
    note: "Organisation identity & logo lookup.",
    envKey: "VITE_WIKIDATA_API_URI",
    base: "https://www.wikidata.org/",
    capabilities: ["deref"],
  },
  commons: {
    id: "commons",
    name: "Wikimedia Commons",
    homepage: "https://commons.wikimedia.org/",
    license: "per-file (CC)",
    licenseHref: "https://commons.wikimedia.org/wiki/Commons:Licensing",
    note: "Organisation logo images.",
    envKey: "VITE_COMMONS_API_URI",
    base: "https://commons.wikimedia.org/",
    // Image blob fetch, not an RDF capability helper — see agentResolver.ts.
    capabilities: [],
  },
  pvgis: {
    id: "pvgis",
    name: "PVGIS (EU JRC)",
    homepage: "https://re.jrc.ec.europa.eu/pvg_tools/",
    note: "Photovoltaic specific-yield grid for the rooftop-PV estimate.",
  },
  basemap: {
    id: "basemap",
    name: "basemap.de / BKG",
    homepage: "https://basemap.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Map base layer.",
  },
  bavariaDop: {
    id: "bavaria-dop",
    name: "Bayerische Vermessungsverwaltung (DOP20c)",
    homepage: "https://geoportal.bayern.de/",
    license: "CC BY 4.0",
    licenseHref: CC_BY_4,
    note: "Aerial orthophoto base layer (Bavaria).",
  },
} as const satisfies Record<string, DataSource>;

/** All sources in display order (the credits-page list). */
export const DATA_SOURCES: readonly DataSource[] = Object.values(SOURCES);

/** Read an env var from Vite (`import.meta.env`) or Deno (`Deno.env`), in that
 *  order; `undefined` if neither is set or readable. The Deno read is guarded so
 *  it is inert (and never throws) in the browser. */
function envVar(key: string): string | undefined {
  const viteEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.[key]) {
    return viteEnv[key];
  }
  try {
    const deno = (globalThis as {
      Deno?: { env?: { get(k: string): string | undefined } };
    }).Deno;
    return deno?.env?.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a source's base IRI runtime-agnostically: the `envKey` override
 * (`import.meta.env` in the browser, `Deno.env` under Deno) wins, else the
 * registered `base`. This is the one place external base resolution lives — the
 * `SourceGateway` default `baseOf` is built from it, and a test can override a
 * base by setting the env var (closing the `headless:local` real-host gap).
 */
export function sourceBase(source: SourceId): string {
  const entry = SOURCES[source];
  const override = entry.envKey ? envVar(entry.envKey) : undefined;
  return override || entry.base || "";
}

/**
 * The regionalstatistik data-cube **geo-dimension IRI** for a German AGS
 * (`<regionalstatistik-base>ags/<ags>`). Written as a building's `dcterms:spatial`
 * and the aggregation spatial coordinate so they JOIN the regionalstatistik cube
 * (regional benchmarks + the AGS-keyed choropleth). NB: this is a *source-cube*
 * dimension value, not the authoritative place concept — the AGS itself is resolved
 * via **linked-lau** (`regionGeometry`), and the canonical region is the LAU/NUTS
 * `skos:Concept`; coupling `dcterms:spatial` to this scheme rather than the LAU
 * concept is a known modelling shortcut (see notes). Lives here next to
 * {@link sourceBase} (not in the `regionalCube` source client) so the RDF serializer
 * and aggregation can build it without importing `services/sources/`, keeping the
 * rdf↔sources dependency acyclic.
 */
export function agsConceptUrl(ags: string): string {
  return `${sourceBase("regionalstatistik")}ags/${ags}`;
}

/** The capability verbs a source declares (empty if none / non-RDF). */
export function sourceCapabilities(source: SourceId): readonly SourceCapability[] {
  return SOURCES[source].capabilities ?? [];
}
