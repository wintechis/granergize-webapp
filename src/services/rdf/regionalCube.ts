/**
 * Read `linked-regionalstatistik` (German Regionalstatistik/GENESIS) as an RDF
 * Data Cube: `<base>/data/{tableId}` serves `qb:Observation`s, each carrying a
 * geo dimension (`…#dim-geo → …/ags/{code}`), a year (`…#dim-TIME_PERIOD`), a
 * measure (`…#measure-OBS_VALUE`) and a unit (`…#unit`). The dimension/measure
 * predicates are table-scoped, so we match them by **suffix** (table-agnostic).
 *
 * A queried, off-Pod external-observation source (the place-joined sibling of
 * weather) — reached through {@link trackedFetch} so it shows in the global
 * loading indicator and retries transient throttling. The parse is split out
 * pure for offline unit-testing.
 */
import { DataFactory } from "n3";
import { QB_NS, RDF_TYPE } from "./vocabularies.ts";
import { parseRdfText } from "./rdfHelpers.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";
import type { MessageId } from "../../lib/messages.ts";

const { namedNode } = DataFactory;

/** One (year, value) point of a regional measure, with its source unit (e.g. "Prozent"). */
export interface RegionalObservation {
  year: number;
  value: number;
  unit: string;
}

/** A regional-statistics table surfaced in the UI, joined at the given AGS grain. */
export interface RegionalTable {
  /** GENESIS table id, e.g. "86251-Z-02". */
  tableId: string;
  /** Catalog id for the human metric label. */
  labelId: MessageId;
  /** Which AGS grain its geo dimension uses — Bundesland (2-digit) or Kreis (5-digit). */
  grain: "land" | "kreis";
}

/**
 * The tables surfaced in the Regional-context section. MVP: directly-comparable
 * **rates/shares** (no per-area/per-capita normalisation needed). Renewable
 * electricity share is Bundesland-grain — joined from the building's `region`
 * via {@link bundeslandToAgs}. Kreis-grain absolute tables come later (need the
 * lat/long → Kreis resolver).
 */
export const REGIONAL_TABLES: RegionalTable[] = [
  { tableId: "86251-Z-02", labelId: "regRenewableShare", grain: "land" },
];

/** Base URL of the wrapper — Vite proxy in dev, absolute host in prod. Read lazily
 * so importing this module for the pure parser test never touches `import.meta.env`. */
function regionalstatistikBase(): string {
  // Cast (not bare `import.meta.env`) so deno's type-checker — which lacks Vite's
  // ImportMeta typing — accepts it; Vite still injects `import.meta.env` for the
  // browser build. Same pattern as `solidUtils.ts`.
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_REGIONALSTATISTIK_API_URI || "/regionalstatistik-api/";
}

/**
 * Parse a Data Cube Turtle document into the observations for one region
 * (`agsCode`), sorted by year. Pure — the network-free half, unit-tested with a
 * fixture. Observations are matched by the geo dimension's object IRI ending in
 * `/ags/{agsCode}`.
 */
export function parseRegionalObservations(
  turtle: string,
  baseIri: string,
  agsCode: string,
): RegionalObservation[] {
  const store = parseRdfText(turtle, baseIri);
  const observations = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(`${QB_NS}Observation`),
    null,
  );

  const out: RegionalObservation[] = [];
  for (const { subject } of observations) {
    let geo = "";
    let year: number | null = null;
    let value: number | null = null;
    let unit = "";
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p.endsWith("#dim-geo")) geo = q.object.value;
      else if (p.endsWith("#dim-TIME_PERIOD")) year = Number.parseInt(q.object.value, 10);
      else if (p.endsWith("#measure-OBS_VALUE")) value = Number.parseFloat(q.object.value);
      else if (p.endsWith("#unit")) unit = q.object.value;
    }
    if (
      geo.endsWith(`/ags/${agsCode}`) &&
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
  tableId: string,
  agsCode: string,
): Promise<RegionalObservation[]> {
  const url = regionalTableDataUrl(tableId);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    `regional statistics ${tableId}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching regional table ${tableId}`);
  return parseRegionalObservations(await res.text(), url, agsCode);
}

/** The table's dereferenceable **linked-data** IRI — the RDF Data Cube resource we
 * actually fetch (and the Developer-mode source link), not the HTML landing page. */
export function regionalTableDataUrl(tableId: string): string {
  return `${regionalstatistikBase()}data/${tableId}`;
}
