/**
 * Read `linked-regionalstatistik` (German Regionalstatistik/GENESIS) as an RDF
 * Data Cube: `<base>/data/{tableId}` serves `qb:Observation`s, each carrying a
 * geo dimension, a year (`…#dim-TIME_PERIOD`), a measure (`…#measure-OBS_VALUE`)
 * and a unit (`…#unit`). The dimension/measure predicates are table-scoped, so we
 * match them by **suffix** (table-agnostic).
 *
 * Tables are NOT uniform, so each {@link RegionalTable} declares how to read it:
 * - the **geo dimension** differs (`#dim-geo` → `…/ags/{code}` for the energy/CO₂
 *   family; `#dim-DINSG` → `…/cl/DINSG#{code}` for the industrial-energy family),
 * - multi-dimension tables carry extra dimensions, so a table fixes them to one
 *   member each via `selectors`, collapsing to one series per year.
 *
 * A queried, off-Pod external-observation source (the place-joined sibling of
 * weather) — reached through {@link trackedFetch} so it shows in the global
 * loading indicator and retries transient throttling. The parse is split out
 * pure for offline unit-testing.
 */
import { QB_NS, RDF_TYPE, SKOS_NS } from "./rdf/vocabularies.ts";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { trackedFetch } from "../lib/networkActivity.ts";
import type { MessageId } from "../lib/messages.ts";

/** One (year, value) point of a regional measure, with its source unit (e.g. "Prozent"). */
export interface RegionalObservation {
  year: number;
  value: number;
  unit: string;
}

/** Fixes one auxiliary dimension to a single member, so a multi-dimension table
 *  collapses to one series. Both are matched by suffix/fragment (table-agnostic). */
export interface DimensionSelector {
  /** The dimension predicate's suffix, e.g. "#dim-ENRNW1". */
  dimSuffix: string;
  /** The required member's IRI fragment, e.g. "ENRGTRNW4" (= renewable energy). */
  valueFrag: string;
}

/** A regional-statistics table surfaced in the UI, joined at the given AGS grain. */
export interface RegionalTable {
  /** GENESIS table id, e.g. "86251-Z-02". */
  tableId: string;
  /** Catalog id for the human metric label. */
  labelId: MessageId;
  /** Which AGS grain its geo dimension uses — Bundesland (2-digit) or Kreis (5-digit). */
  grain: "land" | "kreis";
  /** The geo dimension predicate suffix; defaults to "#dim-geo". */
  geoDimSuffix?: string;
  /**
   * How the geo code appears in the geo dimension's object IRI:
   * - "ags" (default): the IRI ends with `/ags/{code}`,
   * - "frag": the IRI is a codelist concept ending `#{code}` (e.g. `…/cl/DINSG#{code}`).
   */
  geoCodeStyle?: "ags" | "frag";
  /** Auxiliary dimensions fixed to one member each (omit for single-series tables). */
  selectors?: DimensionSelector[];
}

/**
 * The tables surfaced in the Regional-context section.
 * - **Land grain** (`86251-Z-02`): renewable electricity share — joined from the
 *   building's `region` via {@link bundeslandToAgs}. The whole `86xxx` energy
 *   family is Bundesländer-only at source.
 * - **Kreis grain** (`43531-01-02-4`): industrial energy use, with the
 *   energy-carrier dimension pinned to "Erneuerbare Energien" (`ENRGTRNW4`) — a
 *   genuine district-level renewable figure. Joined from the building's Kreis,
 *   reverse-geocoded from nearby MaStR units (no point-in-polygon endpoint exists).
 */
export const REGIONAL_TABLES: RegionalTable[] = [
  { tableId: "86251-Z-02", labelId: "regRenewableShare", grain: "land" },
  {
    tableId: "43531-01-02-4",
    labelId: "regKreisRenewableUse",
    grain: "kreis",
    geoDimSuffix: "#dim-DINSG",
    geoCodeStyle: "frag",
    selectors: [{ dimSuffix: "#dim-ENRNW1", valueFrag: "ENRGTRNW4" }],
  },
];

/** Base URI of the wrapper (the CORS-enabled host — fetched directly, no dev proxy).
 * Read lazily so importing this module for the pure parser test never touches
 * `import.meta.env`. */
function regionalstatistikBase(): string {
  // Cast (not bare `import.meta.env`) so deno's type-checker — which lacks Vite's
  // ImportMeta typing — accepts it; Vite still injects `import.meta.env` for the
  // browser build. Same pattern as `solidUtils.ts`.
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_REGIONALSTATISTIK_API_URI || "https://wunderfacts.com/regionalstatistik/";
}

/**
 * Parse a Data Cube Turtle document into the observations for one region
 * (`agsCode`), sorted by year. Pure — the network-free half, unit-tested with a
 * fixture. An observation is kept when its geo dimension matches `agsCode` (per
 * the table's geo style) AND every `selector` dimension matches its fixed member.
 */
export function parseRegionalObservations(
  turtle: string,
  baseIri: string,
  table: RegionalTable,
  agsCode: string,
): RegionalObservation[] {
  const geoDimSuffix = table.geoDimSuffix ?? "#dim-geo";
  const geoCodeStyle = table.geoCodeStyle ?? "ags";
  const selectors = table.selectors ?? [];

  const store = parseRdfText(turtle, baseIri);
  const observations = store.getQuads(
    null,
    RDF_TYPE,
    `${QB_NS}Observation`,
    null,
  );

  const out: RegionalObservation[] = [];
  for (const { subject } of observations) {
    let geo = "";
    let year: number | null = null;
    let value: number | null = null;
    let unit = "";
    const aux = new Map<string, string>();
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p.endsWith(geoDimSuffix)) geo = q.object.value;
      else if (p.endsWith("#dim-TIME_PERIOD")) year = Number.parseInt(q.object.value, 10);
      else if (p.endsWith("#measure-OBS_VALUE")) value = Number.parseFloat(q.object.value);
      else if (p.endsWith("#unit")) unit = q.object.value;
      else {
        for (const s of selectors) if (p.endsWith(s.dimSuffix)) aux.set(s.dimSuffix, q.object.value);
      }
    }
    const geoMatch = geoCodeStyle === "ags"
      ? geo.endsWith(`/ags/${agsCode}`)
      : geo.endsWith(`#${agsCode}`);
    const selMatch = selectors.every((s) =>
      (aux.get(s.dimSuffix) ?? "").endsWith(`#${s.valueFrag}`)
    );
    if (
      geoMatch && selMatch &&
      year != null && !Number.isNaN(year) &&
      value != null && !Number.isNaN(value)
    ) {
      out.push({ year, value, unit });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

/**
 * Fetch + parse the observations for one table and region. Throws on a non-OK
 * response (the caller's query surfaces it). The geo dimension is matched against
 * `agsCode` — a 2-digit Bundesland or 5-digit Kreis depending on the table's grain.
 */
export async function fetchRegionalObservations(
  table: RegionalTable,
  agsCode: string,
): Promise<RegionalObservation[]> {
  const url = regionalTableDataUrl(table.tableId);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    `regional statistics ${table.tableId}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching regional table ${table.tableId}`);
  return parseRegionalObservations(await res.text(), url, table, agsCode);
}

/** The table's dereferenceable **linked-data** IRI — the RDF Data Cube resource we
 * actually fetch (and the Developer-mode source link), not the HTML landing page. */
export function regionalTableDataUrl(tableId: string): string {
  return `${regionalstatistikBase()}data/${tableId}`;
}

/**
 * The dereferenceable IRI of the **place** a metric is about — the geo-dimension
 * value the cube indexes by, reconstructed from the table's geo style: an
 * `…/ags/{code}` region resource ("ags"), or a `…/cl/{scheme}#{code}` codelist
 * concept ("frag"). This is the leaf the app references but does not internalize
 * (no in-app place page); following it hands off to the wrapper — see
 * `explore/explore-app-boundary.md`.
 */
export function regionalGeoUrl(table: RegionalTable, ags: string): string {
  const base = regionalstatistikBase();
  if ((table.geoCodeStyle ?? "ags") === "frag") {
    // Frag style: the codelist scheme name is the geo dimension's local part
    // (e.g. `#dim-DINSG` → `cl/DINSG`).
    const scheme = (table.geoDimSuffix ?? "#dim-geo").replace(/^#dim-/, "");
    return `${base}cl/${scheme}#${ags}`;
  }
  return `${base}ags/${ags}`;
}

const SKOS_NOTATION = `${SKOS_NS}notation`;
const SKOS_PREF_LABEL = `${SKOS_NS}prefLabel`;

/** Lazily-fetched, session-cached AGS → Kreis-name map from the `cl/geo`
 *  codelist (a SKOS scheme of all Kreise und kreisfreie Städte). */
let kreisNamesPromise: Promise<Map<string, string>> | null = null;

async function loadKreisNames(): Promise<Map<string, string>> {
  const url = `${regionalstatistikBase()}cl/geo`;
  const res = await trackedFetch(url, { headers: { Accept: "text/turtle" } }, "regional geo codelist");
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching geo codelist`);
  const store = parseRdfText(await res.text(), url);
  const names = new Map<string, string>();
  for (const q of store.getQuads(null, SKOS_NOTATION, null, null)) {
    const label = store.getQuads(q.subject, SKOS_PREF_LABEL, null, null)[0]?.object.value;
    if (label) names.set(q.object.value, label);
  }
  return names;
}

/**
 * The human Kreis name for a 5-digit AGS (e.g. "09564" → "Nürnberg, kreisfreie
 * Stadt"), from the cached `cl/geo` codelist. Best-effort: returns `null` on a
 * fetch error or an unknown code, so the caller falls back to the bare AGS.
 */
export async function fetchKreisName(ags: string): Promise<string | null> {
  if (!kreisNamesPromise) kreisNamesPromise = loadKreisNames();
  try {
    return (await kreisNamesPromise).get(ags) ?? null;
  } catch {
    kreisNamesPromise = null; // let a later call retry
    return null;
  }
}
