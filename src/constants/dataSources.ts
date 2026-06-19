/**
 * Registry of the external data sources the app consumes — the single source of
 * truth for user-facing **attribution**: the credits page (`pages/DataSources`)
 * lists them all, and `components/SourceNote` cites individual ones under the
 * panels/figures that use them. One entry per source id, mirroring the
 * `vocab/<id>.md` notes.
 *
 * Names + licence tokens are proper nouns / short identifiers, not translated;
 * the surrounding chrome ("Data source:", page title) goes through the message
 * catalog. This is *legal* attribution — visible to all users, never dev-gated
 * (the dev-only raw-RDF links are `RdfSourceLink`, a separate concern).
 */
export interface DataSource {
  /** Stable id (matches the `vocab/<id>.md` note). */
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
}

const DL_DE_BY = "https://www.govdata.de/dl-de/by-2-0";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";

/** Keyed for ergonomic citation: `SOURCES.osm`, `SOURCES.lod2`, … */
export const SOURCES = {
  osm: {
    id: "osm",
    name: "OpenStreetMap / Nominatim",
    homepage: "https://www.openstreetmap.org/copyright",
    license: "ODbL",
    licenseHref: "https://opendatacommons.org/licenses/odbl/1-0/",
    note: "Geocoding building addresses to coordinates.",
  },
  mastr: {
    id: "mastr",
    name: "Marktstammdatenregister (MaStR)",
    homepage: "https://www.marktstammdatenregister.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Nearby energy installations (via linked-mastr).",
  },
  dwd: {
    id: "dwd",
    name: "Deutscher Wetterdienst (DWD)",
    homepage: "https://www.dwd.de/",
    license: "GeoNutzV",
    licenseHref: "https://www.dwd.de/EN/service/copyright/copyright_node.html",
    note: "Weather observations (via linked-wetterdienst).",
  },
  regionalstatistik: {
    id: "regionalstatistik",
    name: "Regionalstatistik (GENESIS)",
    homepage: "https://www.regionalstatistik.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Regional statistics (via linked-regionalstatistik).",
  },
  energieatlas: {
    id: "energieatlas",
    name: "Energie-Atlas Bayern",
    homepage: "https://www.energieatlas.bayern.de/",
    license: "dl-de/by-2.0",
    licenseHref: DL_DE_BY,
    note: "Municipal energy potential, Bavaria (via linked-energieatlas).",
  },
  lod2: {
    id: "lod2",
    name: "LDBV LoD2-BY",
    homepage: "https://www.ldbv.bayern.de/",
    license: "CC BY 4.0",
    licenseHref: CC_BY_4,
    note: "3D roof geometry for rooftop-PV potential (via linked-lod2-by).",
  },
  pvgis: {
    id: "pvgis",
    name: "PVGIS (EU JRC)",
    homepage: "https://re.jrc.ec.europa.eu/pvg_tools/",
    note: "Photovoltaic specific-yield grid for the rooftop-PV estimate.",
  },
  geo: {
    id: "geo",
    name: "Eurostat NUTS / LAU (GISCO)",
    homepage: "https://ec.europa.eu/eurostat/web/gisco",
    note: "Region boundaries & hierarchy (via linked-nuts / linked-lau).",
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
  wikidata: {
    id: "wikidata",
    name: "Wikidata",
    homepage: "https://www.wikidata.org/",
    license: "CC0",
    licenseHref: "https://creativecommons.org/publicdomain/zero/1.0/",
    note: "Organisation identity & logo lookup.",
  },
  commons: {
    id: "commons",
    name: "Wikimedia Commons",
    homepage: "https://commons.wikimedia.org/",
    license: "per-file (CC)",
    licenseHref: "https://commons.wikimedia.org/wiki/Commons:Licensing",
    note: "Organisation logo images.",
  },
} as const satisfies Record<string, DataSource>;

/** All sources in display order (the credits-page list). */
export const DATA_SOURCES: readonly DataSource[] = Object.values(SOURCES);
