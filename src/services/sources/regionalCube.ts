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
import type { Store } from "n3";
import { QB_NS, RDF_TYPE, SKOS_NS, SKOS_PREF_LABEL } from "../rdf/vocabularies.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { deref } from "./capabilities.ts";
import type { MessageId } from "../../lib/messages.ts";
import type { RegionalstatistikRoute } from "../../generated/regionalstatistik.routes.ts";

/** One (year, value) point of a regional measure, with its source unit (e.g. "Prozent"). */
export interface RegionalObservation {
  year: number;
  value: number;
  unit: string;
}

/** Display form for a regional figure's unit (the cube reports German unit names;
 *  e.g. "Prozent" → "%"). Shared by every surface that renders these values. */
export const REGIONAL_UNIT_DISPLAY: Record<string, string> = { Prozent: "%" };

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
  // --- additional GRANERGIZE-relevant tables (verified parse-stable against the
  // live wrapper; several 862xx tables serve a non-deterministic body and were
  // rejected). Land grain: ---
  {
    // Primärenergieverbrauch — absolute TJ (PEV001A), single carrier "Energie insgesamt".
    tableId: "86221-Z-01",
    labelId: "regPrimaryEnergy",
    grain: "land",
    selectors: [
      { dimSuffix: "#dim-ENRGVB1", valueFrag: "ENERGIE01" },
      { dimSuffix: "#dim-PEV001B", valueFrag: "PEV001A" },
    ],
  },
  {
    // Fernwärmeerzeugung aus Kraft-Wärme-Kopplung — absolute TJ.
    tableId: "86251-Z-04",
    labelId: "regDistrictHeatChp",
    grain: "land",
    selectors: [{ dimSuffix: "#dim-PEV009D", valueFrag: "PEV009D" }],
  },
  {
    // Treibhausgasemissionen pro Kopf — all gases (INSGESAMT), absolute t/capita.
    // Geo dim is a codelist concept (#dim-DLANDU), not #dim-geo.
    tableId: "86431-Z-02",
    labelId: "regGhgPerCapita",
    grain: "land",
    geoDimSuffix: "#dim-DLANDU",
    geoCodeStyle: "frag",
    selectors: [
      { dimSuffix: "#dim-THG002", valueFrag: "INSGESAMT" },
      { dimSuffix: "#dim-GAS002B", valueFrag: "GAS002A" },
    ],
  },
  // --- Kreis grain: building permits / completions, multi-family (3+ dwellings),
  // heat-pump-heated (Umweltthermie, BAUPHE07) — the renewable-heating signal. ---
  {
    tableId: "31111-06-01-4",
    labelId: "regHeatPumpPermits",
    grain: "kreis",
    selectors: [
      { dimSuffix: "#dim-BAUPHE", valueFrag: "BAUPHE07" },
      { dimSuffix: "#dim-GEBWH1", valueFrag: "WHGZHL03UM" },
      { dimSuffix: "#dim-WOHN04", valueFrag: "WOHN04" },
    ],
  },
  {
    tableId: "31121-06-01-4",
    labelId: "regHeatPumpCompletions",
    grain: "kreis",
    selectors: [
      { dimSuffix: "#dim-BAUPHE", valueFrag: "BAUPHE07" },
      { dimSuffix: "#dim-GEBWH1", valueFrag: "WHGZHL03UM" },
      { dimSuffix: "#dim-WOHN04", valueFrag: "WOHN04" },
    ],
  },
];

/** Base IRI of linked-regionalstatistik — delegates to the registry resolver (env-overridable). */
function regionalstatistikBase(): string {
  return sourceBase("regionalstatistik");
}

/**
 * The linked-regionalstatistik routes the app dereferences, checked at COMPILE TIME against the
 * wrapper's DEPLOYED route set (`src/generated/regionalstatistik.routes.ts`, regenerated from the
 * live `/routes` manifest — `deno task gen:routes:regionalstatistik`). `data` = the RDF Data Cube
 * table resource (`data/{tableId}`); `cl` = a codelist (`cl/geo` for Kreis names, `cl/{scheme}#…`
 * for frag-style geo dimensions). A rename/removal upstream makes the literal unassignable to
 * {@link RegionalstatistikRoute}, so `deno task check` fails rather than the regional layers
 * silently emptying. (`ags/{code}` is a reference leaf the app builds but does not fetch — it is not
 * a wrapper route, so it stays out of this map.) See `explore/explore-wrapper-contract-drift.md`.
 */
export const REGIONALSTATISTIK_ROUTES = {
  data: "data",
  cl: "cl",
} as const satisfies Record<string, RegionalstatistikRoute>;

/**
 * Parse a Data Cube Turtle document into the observations for one region
 * (`agsCode`), sorted by year. Pure — the network-free half, unit-tested with a
 * fixture. An observation is kept when its geo dimension matches `agsCode` (per
 * the table's geo style) AND every `selector` dimension matches its fixed member.
 */
export function parseRegionalObservations(
  store: Store,
  table: RegionalTable,
  agsCode: string,
): RegionalObservation[] {
  const geoDimSuffix = table.geoDimSuffix ?? "#dim-geo";
  const geoCodeStyle = table.geoCodeStyle ?? "ags";
  const selectors = table.selectors ?? [];

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
  const store = await deref(
    getSourceGateway(),
    regionalTableDataUrl(table.tableId),
    `regional statistics ${table.tableId}`,
  );
  return parseRegionalObservations(store, table, agsCode);
}

/**
 * Parse a Data Cube document into ONE value **per region** — the choropleth's
 * whole-table read (the inverse of {@link parseRegionalObservations}, which filters
 * to one region across years). Returns a Map keyed by the region's **AGS code**
 * (extracted from the geo dimension per the table's geo style), each holding the
 * latest year ≤ `maxYear` (or the overall latest when `maxYear` is omitted). Pure;
 * the network-free half of {@link fetchRegionalChoropleth}.
 */
export function parseRegionalChoropleth(
  store: Store,
  table: RegionalTable,
  maxYear?: number,
): Map<string, RegionalObservation> {
  const geoDimSuffix = table.geoDimSuffix ?? "#dim-geo";
  const geoCodeStyle = table.geoCodeStyle ?? "ags";
  const selectors = table.selectors ?? [];

  const observations = store.getQuads(null, RDF_TYPE, `${QB_NS}Observation`, null);

  const byAgs = new Map<string, RegionalObservation>();
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
      else for (const s of selectors) if (p.endsWith(s.dimSuffix)) aux.set(s.dimSuffix, q.object.value);
    }
    const selMatch = selectors.every((s) =>
      (aux.get(s.dimSuffix) ?? "").endsWith(`#${s.valueFrag}`)
    );
    if (
      !selMatch || year == null || Number.isNaN(year) ||
      value == null || Number.isNaN(value)
    ) continue;
    if (maxYear != null && year > maxYear) continue;
    // Extract the AGS code from the geo dimension's object IRI (inverse of the
    // per-style suffix match in parseRegionalObservations).
    const ags = geoCodeStyle === "ags"
      ? (geo.match(/\/ags\/([^/]+)$/)?.[1] ?? "")
      : (geo.includes("#") ? geo.slice(geo.lastIndexOf("#") + 1) : "");
    if (!ags) continue;
    const prev = byAgs.get(ags);
    if (!prev || year > prev.year) byAgs.set(ags, { year, value, unit });
  }
  return byAgs;
}

/**
 * Fetch + parse the latest value for every region of a table — one GET serves the
 * whole choropleth layer. Throws on a non-OK response (the caller's query surfaces it).
 */
export async function fetchRegionalChoropleth(
  table: RegionalTable,
  maxYear?: number,
): Promise<Map<string, RegionalObservation>> {
  const store = await deref(
    getSourceGateway(),
    regionalTableDataUrl(table.tableId),
    `regional choropleth ${table.tableId}`,
  );
  return parseRegionalChoropleth(store, table, maxYear);
}

/** The table's dereferenceable **linked-data** IRI — the RDF Data Cube resource we
 * actually fetch (and the Developer-mode source link), not the HTML landing page. */
export function regionalTableDataUrl(tableId: string): string {
  return `${regionalstatistikBase()}${REGIONALSTATISTIK_ROUTES.data}/${tableId}`;
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
    return `${base}${REGIONALSTATISTIK_ROUTES.cl}/${scheme}#${ags}`;
  }
  return `${base}ags/${ags}`;
}

// `agsConceptUrl` (the canonical `…/ags/{code}` region-concept IRI, used as a
// building's `dcterms:spatial` and the choropleth AGS join key) moved to
// `constants/dataSources.ts` so non-source layers (the RDF serializer, aggregation)
// can build it without importing this source client — keeps rdf↔sources acyclic.

const SKOS_NOTATION = `${SKOS_NS}notation`;

/** Lazily-fetched, session-cached AGS → Kreis-name map from the `cl/geo`
 *  codelist (a SKOS scheme of all Kreise und kreisfreie Städte). */
let kreisNamesPromise: Promise<Map<string, string>> | null = null;

async function loadKreisNames(): Promise<Map<string, string>> {
  const store = await deref(
    getSourceGateway(),
    `${regionalstatistikBase()}${REGIONALSTATISTIK_ROUTES.cl}/geo`,
    "regional geo codelist",
  );
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
