import type { PodGateway } from "../pod/podGateway.ts";
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
import {
  observationContainer,
  type ObservationRef,
  observationUri,
  parseObservationUri,
} from "./observationPath.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { logError } from "../../lib/logError.ts";

const { namedNode } = DataFactory;

export type { EnergyDatasetRef, Scenario };

/**
 * The unified energy model: ONE `cons:EnergyDataset` per (building, year,
 * granularity, scenario), linked from the building by a single
 * `cons:hasEnergyDataset` predicate.
 *
 * Datasets are **time-first**, first-class observation collections — they live
 * at top-level `observations/…` (see {@link observationUri} /
 * `observationPath.ts`), NOT nested under the building. Each dataset is its own
 * resource (annual included), so a year can be added, edited and shared
 * independently. A UUID stem `{id}` is minted per dataset and sits at the leaf;
 * depth follows resolution:
 *
 *   annual  `observations/{year}/{id}.ttl`
 *   series  `observations/{year}/{id}.ttl`   (descriptor; daily chunks at
 *           `observations/{year}/{month}/{day}/{id}.ttl`, same `{id}`)
 *
 * Scenario (actual/planned) and granularity are **properties of the dataset**,
 * not encoded in the path. So that phase-1 (map paint) can dispatch load
 * (series lazy, annual prefetched) WITHOUT fetching each dataset, the building
 * file re-states `cons:granularity` and `cons:scenario` about the linked
 * dataset node next to the `cons:hasEnergyDataset` link:
 *
 *   <#b> cons:hasEnergyDataset <…/2024/abc.ttl#ds> .
 *   <…/2024/abc.ttl#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
 *
 * The dataset resource itself remains the authoritative copy of those triples.
 *
 * Annual aggregate (small → inline `sosa:ObservationCollection`):
 *   <#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
 *      cons:ofBuilding <…/b-1.ttl#it> ; cons:granularity "P1Y" ;
 *      cons:scenario cons:Actual ;
 *      sosa:phenomenonTime [ a time:Interval ; time:hasBeginning "2024-01-01"^^xsd:date ;
 *                            time:hasEnd "2024-12-31"^^xsd:date ] ;
 *      sosa:hasMember [ a sosa:Observation ;
 *        sosa:observedProperty cons:ElectricityConsumption ;
 *        sosa:hasResult [ sosa:hasSimpleResult "121500"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ] , … .
 *
 * Sub-hourly series (large → daily chunk files spread across the year's
 * time-first sub-containers, located by the year container):
 *   <#ds> a cons:EnergyDataset ; … cons:granularity "PT15M" ;
 *      cons:datasetLocation <observations/2024/> .
 */

export type EnergyMetricKey =
  | "electricityConsumption"
  | "heatConsumption"
  | "waterConsumption"
  | "wastewaterConsumption"
  | "renewableSelfGeneratedShare"
  | "electricityGeneration";

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
  electricityGeneration: {
    prop: `${CONSUMPTION_NS}ElectricityGeneration`,
    unit: `${UNIT_NS}KiloW-HR`,
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
  /** Series: the container IRI the daily chunk files are located under. */
  datasetLocation?: string;
  /**
   * The `sosa:hasFeatureOfInterest` the observations are about, when it is a
   * specific component rather than the building as a whole — e.g. generation
   * observations are about the building's `<#pv>` :PVSystem plant. An IRI
   * reference (may be document-relative). Omitted ⇒ the building is the implicit
   * feature of interest (via `cons:ofBuilding`).
   */
  featureOfInterest?: string;
}

/** A discovered **building-less** observation — an annual dataset in the user's own
 *  `observations/` that no building links (`building === ""`), carrying its node IRI
 *  for the finder row + the "link to a building" action. */
export interface BuildinglessObservation extends EnergyDataset {
  /** The dataset node IRI (`#ds` in its file). */
  uri: string;
}

/** Mint a fresh dataset id (UUID stem) for a new observation collection. */
export function mintDatasetId(): string {
  return crypto.randomUUID();
}

/** The `observations/` root for a building, from its file/subject IRI. */
export function observationsRootForBuilding(buildingUri: string): string {
  const file = buildingUri.split("#")[0];
  const i = file.indexOf("/buildings/");
  if (i === -1) {
    throw new Error(`Not a building IRI under buildings/: ${buildingUri}`);
  }
  return `${file.slice(0, i)}/observations/`;
}

/** The `observations/` root for an observation IRI (the inverse direction). */
export function observationsRootForObservation(uri: string): string {
  const file = uri.split("#")[0];
  const marker = "/observations/";
  const i = file.indexOf(marker);
  if (i === -1) {
    throw new Error(`Not an observation IRI under observations/: ${uri}`);
  }
  return file.slice(0, i + marker.length);
}

/** `observations/{year}/{id}.ttl` — the dataset descriptor resource IRI. */
export function datasetFileUri(observationsRoot: string, year: number, id: string): string {
  return observationUri(observationsRoot, { year, id });
}

/** The dataset's subject node IRI (`<file>#ds`). */
export function datasetNodeUri(fileUri: string): string {
  return `${fileUri}#ds`;
}

/** A series dataset's locating container — the year period container. */
export function seriesContainerUri(observationsRoot: string, year: number): string {
  return observationContainer(observationsRoot, { year });
}

/**
 * One daily chunk file of a series, time-first under its day:
 * `observations/{year}/{month}/{day}/{id}.ttl`. `date` is `YYYY-MM-DD`.
 */
export function seriesDailyFileUri(
  observationsRoot: string,
  date: string,
  id: string,
): string {
  const [y, m, d] = date.split("-").map(Number);
  return observationUri(observationsRoot, { year: y, month: m, day: d, id });
}

/**
 * List a series dataset's daily chunk files. The descriptor's `datasetLocation`
 * is its year container; the day chunks are the same-`{id}` leaves under that
 * year's time-first `{month}/{day}/` sub-containers. Walks the year → month →
 * day containers, collecting `…/{id}.ttl` leaves. Each entry is `{ day, uri }` —
 * `day` the file's `YYYY-MM-DD` (recovered from its path), `uri` the chunk to
 * fetch — sorted ascending by day. A missing/inaccessible container yields `[]`.
 * @operation query
 */
export async function listSeriesDays(
  gateway: PodGateway,
  ref: EnergyDatasetRef,
): Promise<{ day: string; uri: string }[]> {
  const root = observationsRootForObservation(ref.uri);
  const parsed = parseObservationUri(root, ref.uri);
  if (!parsed) return [];
  const { year, id } = parsed;
  const out: { day: string; uri: string }[] = [];

  const months = (await listDirectChildren(
    observationContainer(root, { year }),
    gateway,
  )) ?? [];
  await Promise.all(
    months
      .filter((u) => u.endsWith("/"))
      .map(async (monthUrl) => {
        const month = Number(monthUrl.replace(/\/$/, "").split("/").pop());
        if (!Number.isInteger(month)) return;
        const days = (await listDirectChildren(monthUrl, gateway)) ?? [];
        await Promise.all(
          days
            .filter((u) => u.endsWith("/"))
            .map(async (dayUrl) => {
              const day = Number(dayUrl.replace(/\/$/, "").split("/").pop());
              if (!Number.isInteger(day)) return;
              const files = (await listDirectChildren(dayUrl, gateway)) ?? [];
              for (const f of files) {
                if (f === `${dayUrl}${id}.ttl`) {
                  const date = `${year}-${pad(month)}-${pad(day)}`;
                  out.push({ day: date, uri: f });
                }
              }
            }),
        );
      }),
  );
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Parse a `cons:hasEnergyDataset` link into an {@link EnergyDatasetRef}. The
 * link IRI gives the dataset's file/node and (via its time-first path) the
 * year; the granularity and scenario are read from the triples the building
 * re-states about the dataset node (`store`, when given) — or default to
 * `P1Y`/`actual` when no store is available. Returns null if the link isn't a
 * time-first observation IRI.
 */
export function parseDatasetLink(
  linkUri: string,
  store?: Store,
): EnergyDatasetRef | null {
  let root: string;
  try {
    root = observationsRootForObservation(linkUri);
  } catch {
    return null; // not a time-first observation IRI
  }
  const parsed = parseObservationUri(root, linkUri);
  if (!parsed) return null;
  let granularity = "P1Y";
  let scenario: Scenario = "actual";
  let featureOfInterest: string | undefined;
  if (store) {
    const node = namedNode(linkUri);
    granularity =
      store.getObjects(node, namedNode(`${CONSUMPTION_NS}granularity`), null)[0]
        ?.value ?? granularity;
    const sc = store.getObjects(node, namedNode(`${CONSUMPTION_NS}scenario`), null)[0]
      ?.value;
    if (sc === `${CONSUMPTION_NS}Planned`) scenario = "planned";
    featureOfInterest = store
      .getObjects(node, namedNode(`${SOSA_NS}hasFeatureOfInterest`), null)[0]?.value;
  }
  return { uri: linkUri, year: parsed.year, granularity, scenario, featureOfInterest };
}

/**
 * All dataset refs linked from a building node (`cons:hasEnergyDataset`).
 * `buildingNodeUri: null` matches ANY subject — for a fetched building file,
 * which holds only that one building's links. Granularity/scenario are read
 * from the building-file triples re-stated about each dataset node.
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
    .map((o) => parseDatasetLink(o.value, store))
    .filter((r): r is EnergyDatasetRef => r !== null);
}

/**
 * The existing `cons:hasEnergyDataset` node IRI on a building that matches
 * `(year, granularity, scenario)`, or null when none — so a re-save of the same
 * (year, granularity, scenario) overwrites in place instead of minting a second
 * dataset (the path no longer encodes those, so the match comes from the refs).
 */
export function findDatasetLink(
  store: Store,
  buildingSubjectUri: string,
  year: number,
  granularity: string,
  scenario: Scenario,
  featureOfInterest?: string,
): string | null {
  for (const ref of parseEnergyDatasetRefs(store, buildingSubjectUri)) {
    if (
      ref.year === year && ref.granularity === granularity &&
      ref.scenario === scenario &&
      // FoI is part of the identity: a per-unit dataset (e.g. the <#pv> series)
      // must NOT match the building's for the same (year, granularity, scenario).
      (ref.featureOfInterest ?? "") === (featureOfInterest ?? "")
    ) {
      return ref.uri;
    }
  }
  return null;
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

  // The component the observations are about, when not the building itself
  // (e.g. generation is about the <#pv> plant). Reuses SOSA directly.
  const foi = ds.featureOfInterest
    ? `   sosa:hasFeatureOfInterest <${ds.featureOfInterest}> ;\n`
    : "";

  // The building this observation is about — OMITTED when unbound (a building-less
  // observation, to be linked to a building later); emitting `<>` would be invalid.
  const ofBuilding = ds.building
    ? `   cons:ofBuilding <${ds.building}> ;\n`
    : "";

  if (ds.datasetLocation) {
    return header +
      `<#ds> a cons:EnergyDataset ;\n` +
      ofBuilding +
      foi +
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
    ofBuilding +
    foi +
    `   cons:granularity "${ds.granularity}" ;\n` +
    `   cons:scenario ${scenarioIri} ;\n` +
    `   sosa:phenomenonTime ${interval}` +
    (members ? ` ;\n   sosa:hasMember\n${members} .\n` : ` .\n`);
}

/**
 * Fetch and parse a set of energy datasets (given their refs) concurrently — for
 * the per-building detail views that need the full annual history. Unreadable
 * datasets are skipped. `fetchFn` is typically `gateway.fetch.bind(gateway)`.
 * @operation query
 */
export async function loadEnergyDatasets(
  refs: EnergyDatasetRef[],
  fetchFn: (uri: string) => Promise<Response>,
): Promise<EnergyDataset[]> {
  const out: EnergyDataset[] = [];
  await Promise.all(refs.map(async (ref) => {
    try {
      const fileUri = ref.uri.split("#")[0];
      const res = await fetchFn(fileUri);
      if (!res.ok) return;
      const store = new Store(
        new Parser({ baseIRI: fileUri }).parse(await res.text()),
      );
      const ds = parseEnergyDataset(store, ref.uri);
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
  const featureOfInterest = store
    .getObjects(ds, namedNode(`${SOSA_NS}hasFeatureOfInterest`), null)[0]?.value;

  const location = store.getObjects(
    ds,
    namedNode(`${CONSUMPTION_NS}datasetLocation`),
    null,
  )[0]?.value;
  if (location) {
    return {
      building,
      year,
      granularity,
      scenario,
      datasetLocation: location,
      featureOfInterest,
    };
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
  return { building, year, granularity, scenario, metrics, featureOfInterest };
}

export type { ObservationRef };
