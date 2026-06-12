import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import {
  CONSUMPTION_NS,
  RDF_TYPE,
  SOSA_NS,
  SSN_NS,
  TIME_NS,
  UNIT_NS,
} from "./vocabularies.ts";
import type { EnergyDatasetRef, Scenario } from "../../types.ts";
import { buildingFileUrl } from "./building/buildingId.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { logError } from "../../lib/logError.ts";

const { namedNode } = DataFactory;

export type { EnergyDatasetRef, Scenario };

/**
 * The unified energy model: ONE `cons:EnergyDataset` per (building, year,
 * granularity, scenario), linked from the building by a single
 * `cons:hasEnergyDataset` predicate — replacing the old three-way split
 * (`investor:hasAnnualData` inline annual / `cons:hasEnergyMeasurementData`
 * / `cons:hasEnergyConsumptionDataset`). Every dataset is its OWN resource
 * (annual included), so a year can be added, edited and shared independently.
 *
 *   <#b> cons:hasEnergyDataset <energy/2024-P1Y.ttl#ds> , <energy/2024-PT15M.ttl#ds> .
 *
 * The link's slug (`<year>-<granularity>[-planned].ttl`) is self-describing, so
 * the year/granularity/scenario are known WITHOUT fetching the dataset — phase-1
 * (map paint) reads the links; phase-2 fetches the annual datasets and lazy-loads
 * series on click, dispatching purely on the declared granularity.
 *
 * Annual aggregate (small → inline `sosa:ObservationCollection`):
 *   <#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
 *      cons:ofBuilding <…/b-1.ttl#b-1> ; cons:granularity "P1Y" ;
 *      cons:scenario cons:Actual ;
 *      sosa:phenomenonTime [ a time:Interval ; time:hasBeginning "2024-01-01"^^xsd:date ;
 *                            time:hasEnd "2024-12-31"^^xsd:date ] ;
 *      sosa:hasMember [ a sosa:Observation ;
 *        sosa:observedProperty cons:ElectricityConsumption ;
 *        sosa:hasResult [ sosa:hasSimpleResult "121500"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ] , … .
 *
 * Sub-hourly series (large → a located container of daily reading files):
 *   <#ds> a cons:EnergyDataset ; … cons:granularity "PT15M" ;
 *      cons:datasetLocation <2024-PT15M/> .
 */

export type EnergyMetricKey =
  | "electricityConsumption"
  | "heatConsumption"
  | "waterConsumption"
  | "wastewaterConsumption"
  | "renewableSelfGeneratedShare";

export type AnnualMetrics = Partial<Record<EnergyMetricKey, number>>;

/** Each metric's observed-property IRI + result unit IRI (unified under cons:). */
export const ENERGY_METRICS: Record<
  EnergyMetricKey,
  { prop: string; unit: string }
> = {
  electricityConsumption: {
    prop: `${CONSUMPTION_NS}ElectricityConsumption`,
    unit: `${UNIT_NS}KiloW-HR`,
  },
  heatConsumption: {
    prop: `${CONSUMPTION_NS}HeatConsumption`,
    unit: `${UNIT_NS}KiloW-HR`,
  },
  waterConsumption: {
    prop: `${CONSUMPTION_NS}WaterConsumption`,
    unit: `${UNIT_NS}M3`,
  },
  wastewaterConsumption: {
    prop: `${CONSUMPTION_NS}WastewaterConsumption`,
    unit: `${UNIT_NS}M3`,
  },
  renewableSelfGeneratedShare: {
    prop: `${CONSUMPTION_NS}RenewableSelfGeneratedShare`,
    unit: `${UNIT_NS}PERCENT`,
  },
};

const PROP_TO_METRIC: Record<string, EnergyMetricKey> = Object.fromEntries(
  (Object.entries(ENERGY_METRICS) as [EnergyMetricKey, { prop: string }][])
    .map(([k, v]) => [v.prop, k]),
);

/** A full energy dataset (annual aggregate inline, or a series descriptor). */
export interface EnergyDataset {
  /** The building subject URI (`cons:ofBuilding`). */
  building: string;
  year: number;
  /** xsd:duration: "P1Y" annual, "PT15M" sub-hourly series, … */
  granularity: string;
  scenario: Scenario;
  /** Annual aggregate: the inline observations. */
  metrics?: AnnualMetrics;
  /** Series: the container URL of the daily reading files. */
  datasetLocation?: string;
}

/** `<year>-<granularity>[-planned]` — the self-describing resource slug. */
export function datasetSlug(
  year: number,
  granularity: string,
  scenario: Scenario,
): string {
  return `${year}-${granularity}${scenario === "planned" ? "-planned" : ""}`;
}

/** `…/buildings/<id>/energy/<slug>.ttl` — the dataset resource URL. */
export function datasetFileUrl(
  buildingUri: string,
  year: number,
  granularity: string,
  scenario: Scenario,
): string {
  const base = buildingFileUrl(buildingUri).replace(/\.ttl$/, "");
  return `${base}/energy/${datasetSlug(year, granularity, scenario)}.ttl`;
}

/** The dataset's subject node URL (`<file>#ds`). */
export function datasetNodeUrl(fileUrl: string): string {
  return `${fileUrl}#ds`;
}

/** A series dataset's daily-files container (`…/energy/<year>-PT15M/`). */
export function seriesContainerUrl(
  buildingUri: string,
  year: number,
  scenario: Scenario = "actual",
): string {
  return datasetFileUrl(buildingUri, year, "PT15M", scenario).replace(
    /\.ttl$/,
    "/",
  );
}

/** One daily reading file inside a series container (`…/<year>-PT15M/<date>.ttl`). */
export function seriesDailyFileUrl(
  buildingUri: string,
  year: number,
  date: string,
  scenario: Scenario = "actual",
): string {
  return `${seriesContainerUrl(buildingUri, year, scenario)}${date}.ttl`;
}

/**
 * List a series dataset's daily reading files. Owns the descriptor→container
 * convention: the ref's `…/<slug>.ttl` descriptor locates its sibling
 * `…/<slug>/` container, whose `<date>.ttl` children are the days. Each entry
 * is `{ day, url }` — `day` is the file's date label (e.g. `"2024-03-15"`),
 * `url` the reading file to fetch — sorted ascending by day. A missing or
 * inaccessible container yields `[]`.
 * @operation query
 */
export async function listSeriesDays(
  session: Session,
  ref: EnergyDatasetRef,
): Promise<{ day: string; url: string }[]> {
  const container = ref.url.split("#")[0].replace(/\.ttl$/, "/");
  const children = (await listDirectChildren(container, session)) ?? [];
  return children
    .filter((url) => url.endsWith(".ttl"))
    .map((url) => ({ day: url.split("/").pop()!.replace(/\.ttl$/, ""), url }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Derive `{year, granularity, scenario}` from a `cons:hasEnergyDataset` link URL
 * by parsing its slug — so phase-1 needn't fetch each dataset. Returns null if
 * the slug isn't the expected `<year>-<granularity>[-planned]` shape.
 */
export function parseDatasetSlug(linkUrl: string): EnergyDatasetRef | null {
  const file = linkUrl.split("#")[0];
  let slug = file.split("/").pop()?.replace(/\.ttl$/, "") ?? "";
  let scenario: Scenario = "actual";
  if (slug.endsWith("-planned")) {
    scenario = "planned";
    slug = slug.slice(0, -"-planned".length);
  }
  const dash = slug.indexOf("-");
  if (dash === -1) return null;
  const year = Number(slug.slice(0, dash));
  const granularity = slug.slice(dash + 1);
  if (!Number.isInteger(year) || !granularity) return null;
  return { url: linkUrl, year, granularity, scenario };
}

/**
 * All dataset refs linked from a building node (`cons:hasEnergyDataset`).
 * `buildingNodeUri: null` matches ANY subject — for a fetched building file,
 * which holds only that one building's links.
 */
export function parseEnergyDatasetRefs(
  store: Store,
  buildingNodeUri: string | null,
): EnergyDatasetRef[] {
  return store
    .getObjects(
      buildingNodeUri === null ? null : namedNode(buildingNodeUri),
      namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
      null,
    )
    .map((o) => parseDatasetSlug(o.value))
    .filter((r): r is EnergyDatasetRef => r !== null);
}

/**
 * Serialize one `cons:EnergyDataset` resource (subject `<#ds>`, relative to the
 * file it's PUT at). Emits the inline observation collection for an annual
 * aggregate, or the located descriptor when `datasetLocation` is set.
 */
export function serializeEnergyDataset(ds: EnergyDataset): string {
  const scenarioIri = ds.scenario === "planned" ? "cons:Planned" : "cons:Actual";
  const interval = `[ a time:Interval ;\n` +
    `        time:hasBeginning "${ds.year}-01-01"^^xsd:date ;\n` +
    `        time:hasEnd "${ds.year}-12-31"^^xsd:date ]`;
  const header = [
    `@prefix cons: <${CONSUMPTION_NS}> .`,
    `@prefix sosa: <${SOSA_NS}> .`,
    `@prefix ssn: <${SSN_NS}> .`,
    `@prefix time: <${TIME_NS}> .`,
    `@prefix unit: <${UNIT_NS}> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    "",
    "",
  ].join("\n");

  if (ds.datasetLocation) {
    return header +
      `<#ds> a cons:EnergyDataset ;\n` +
      `   cons:ofBuilding <${ds.building}> ;\n` +
      `   cons:granularity "${ds.granularity}" ;\n` +
      `   cons:scenario ${scenarioIri} ;\n` +
      `   sosa:phenomenonTime ${interval} ;\n` +
      `   cons:datasetLocation <${ds.datasetLocation}> .\n`;
  }

  const members = (Object.entries(ds.metrics ?? {}) as [EnergyMetricKey, number][])
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const m = ENERGY_METRICS[k];
      return `      [ a sosa:Observation ; sosa:observedProperty <${m.prop}> ;\n` +
        `        sosa:hasResult [ sosa:hasSimpleResult "${v}"^^xsd:decimal ;\n` +
        `                         ssn:hasUnit <${m.unit}> ] ]`;
    })
    .join(" ,\n");

  return header +
    `<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;\n` +
    `   cons:ofBuilding <${ds.building}> ;\n` +
    `   cons:granularity "${ds.granularity}" ;\n` +
    `   cons:scenario ${scenarioIri} ;\n` +
    `   sosa:phenomenonTime ${interval}` +
    (members ? ` ;\n   sosa:hasMember\n${members} .\n` : ` .\n`);
}

/**
 * Fetch and parse a set of energy datasets (given their refs) concurrently — for
 * the per-building detail views that need the full annual history. Unreadable
 * datasets are skipped. `fetchFn` is typically `session.fetch.bind(session)`.
 * @operation query
 */
export async function loadEnergyDatasets(
  refs: EnergyDatasetRef[],
  fetchFn: (url: string) => Promise<Response>,
): Promise<EnergyDataset[]> {
  const out: EnergyDataset[] = [];
  await Promise.all(refs.map(async (ref) => {
    try {
      const fileUrl = ref.url.split("#")[0];
      const res = await fetchFn(fileUrl);
      if (!res.ok) return;
      const store = new Store(
        new Parser({ baseIRI: fileUrl }).parse(await res.text()),
      );
      const ds = parseEnergyDataset(store, ref.url);
      if (ds) out.push(ds);
    } catch (err) {
      logError("load energy dataset", err);
      // Skip an unreadable dataset (e.g. access revoked) — non-fatal.
    }
  }));
  return out;
}

/** Year (from the period's beginning) for a parsed dataset node; 0 if absent. */
function yearOf(store: Store, ds: ReturnType<typeof namedNode>): number {
  const interval = store.getObjects(ds, namedNode(`${SOSA_NS}phenomenonTime`), null)[0];
  if (!interval) return 0;
  const begin = store.getObjects(
    interval,
    namedNode(`${TIME_NS}hasBeginning`),
    null,
  )[0]?.value;
  const y = begin ? Number(begin.slice(0, 4)) : 0;
  return Number.isInteger(y) ? y : 0;
}

/**
 * Parse one `cons:EnergyDataset` resource (its `<#ds>` node) from a store into an
 * {@link EnergyDataset}. Returns null if the node isn't a `cons:EnergyDataset`.
 */
export function parseEnergyDataset(
  store: Store,
  datasetNodeUri: string,
): EnergyDataset | null {
  const ds = namedNode(datasetNodeUri);
  const isDataset = store.getQuads(
    ds,
    namedNode(RDF_TYPE),
    namedNode(`${CONSUMPTION_NS}EnergyDataset`),
    null,
  ).length > 0;
  if (!isDataset) return null;

  const building =
    store.getObjects(ds, namedNode(`${CONSUMPTION_NS}ofBuilding`), null)[0]?.value ?? "";
  const granularity =
    store.getObjects(ds, namedNode(`${CONSUMPTION_NS}granularity`), null)[0]?.value ?? "";
  const scenarioIri = store.getObjects(ds, namedNode(`${CONSUMPTION_NS}scenario`), null)[0]
    ?.value;
  const scenario: Scenario = scenarioIri === `${CONSUMPTION_NS}Planned`
    ? "planned"
    : "actual";
  const year = yearOf(store, ds);

  const location = store.getObjects(
    ds,
    namedNode(`${CONSUMPTION_NS}datasetLocation`),
    null,
  )[0]?.value;
  if (location) {
    return { building, year, granularity, scenario, datasetLocation: location };
  }

  const metrics: AnnualMetrics = {};
  for (const member of store.getObjects(ds, namedNode(`${SOSA_NS}hasMember`), null)) {
    const prop =
      store.getObjects(member, namedNode(`${SOSA_NS}observedProperty`), null)[0]
        ?.value;
    const key = prop ? PROP_TO_METRIC[prop] : undefined;
    if (!key) continue;
    const result = store.getObjects(member, namedNode(`${SOSA_NS}hasResult`), null)[0];
    const val = result
      ? store.getObjects(result, namedNode(`${SOSA_NS}hasSimpleResult`), null)[0]
        ?.value
      : undefined;
    if (val !== undefined) metrics[key] = Number(val);
  }
  return { building, year, granularity, scenario, metrics };
}
