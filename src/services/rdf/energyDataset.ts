import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory, Parser, Store, Writer } from "n3";
import type { BlankNode, Literal, NamedNode, Term } from "n3";
import {
  CONSUMPTION_NS,
  RDF_TYPE,
  SOSA_NS,
  SSN_NS,
  TIME_NS,
  UNIT_NS,
  XSD_DATE,
  XSD_DECIMAL,
  XSD_DURATION,
  XSD_NS,
} from "./vocabularies.ts";
import { VOCAB_SCHEMA } from "./vocabSchema.generated.ts";
import type { EnergyDatasetRef, Scenario } from "../../types.ts";
import { sameUnit, toCanonical } from "../energy/units.ts";
import {
  observationContainer,
  type ObservationRef,
  observationUri,
  parseObservationUri,
} from "./observationPath.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { logError } from "../../lib/logError.ts";

const { namedNode, literal, blankNode } = DataFactory;

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

/** The energy metric keys, in cube/UI order. Each maps to a `cons:` observed-property
 *  IRI by PascalCase; its canonical unit comes from the vocab (`cons:canonicalUnit`). */
export const METRIC_KEYS = [
  "electricityConsumption",
  "heatConsumption",
  "waterConsumption",
  "wastewaterConsumption",
  "renewableSelfGeneratedShare",
  "electricityGeneration",
] as const;

export type EnergyMetricKey = typeof METRIC_KEYS[number];

export type AnnualMetrics = Partial<Record<EnergyMetricKey, number>>;

const pascal = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);

/** Each metric's observed-property IRI + canonical result unit IRI — derived from the
 *  metric key (its PascalCase name under `cons:`) and the vocab's `cons:canonicalUnit`
 *  (see vocabSchema.generated.ts), so the units live in one place: the ontology. */
export const ENERGY_METRICS: Record<EnergyMetricKey, { prop: string; unit: string }> = Object
  .fromEntries(
    METRIC_KEYS.map((key) => {
      const prop = `${CONSUMPTION_NS}${pascal(key)}`;
      const unit = VOCAB_SCHEMA[prop]?.unit;
      if (!unit) throw new Error(`vocab declares no cons:canonicalUnit for ${prop}`);
      return [key, { prop, unit }];
    }),
  ) as Record<EnergyMetricKey, { prop: string; unit: string }>;

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
  /** Annual aggregate: the inline observations. Values are ALWAYS canonical (kWh / m³ /
   *  %) — a non-canonical `ssn:hasUnit` is normalised on read (see {@link units}). */
  metrics?: AnnualMetrics;
  /** The ORIGINAL unit IRI per metric, recorded only when it differed from the metric's
   *  canonical unit (e.g. a building whose energy is in MWh). Drives the display/export to
   *  show the building's own unit; the numeric `metrics` stay canonical so the maths is
   *  unaffected. Absent ⇒ everything is canonical. */
  units?: Partial<Record<EnergyMetricKey, string>>;
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
    .map((o: Term) => parseDatasetLink(o.value, store))
    .filter((r: EnergyDatasetRef | null): r is EnergyDatasetRef => r !== null);
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
  const writer = new Writer({
    prefixes: {
      cons: CONSUMPTION_NS,
      sosa: SOSA_NS,
      ssn: SSN_NS,
      time: TIME_NS,
      unit: UNIT_NS,
      xsd: XSD_NS,
    },
  });
  // Feed quads straight to the Writer (not via an n3 Store): the Store's entity
  // index mangles a document-relative IRI like `../../buildings/x.ttl#pv`, which
  // a featureOfInterest may legitimately be; the Writer serializes term values
  // verbatim. Subject is relative to the file it is PUT at — written `<#ds>`.
  const node = namedNode("#ds");
  const type = namedNode(RDF_TYPE);
  const cons = (local: string) => namedNode(`${CONSUMPTION_NS}${local}`);
  const sosa = (local: string) => namedNode(`${SOSA_NS}${local}`);
  const add = (
    s: NamedNode | BlankNode,
    p: NamedNode,
    o: NamedNode | BlankNode | Literal,
  ) => writer.addQuad(s, p, o);

  add(node, type, cons("EnergyDataset"));
  // An annual aggregate also declares sosa:ObservationCollection (so aggregators
  // can spot it); the located series descriptor does not.
  if (!ds.datasetLocation) add(node, type, sosa("ObservationCollection"));

  // The building this observation is about — OMITTED when unbound (a building-less
  // observation, linked to a building later); emitting `<>` would be invalid.
  if (ds.building) add(node, cons("ofBuilding"), namedNode(ds.building));
  // The component the observations are about, when not the building itself
  // (e.g. generation is about the <#pv> plant). Reuses SOSA directly.
  if (ds.featureOfInterest) {
    add(node, sosa("hasFeatureOfInterest"), namedNode(ds.featureOfInterest));
  }
  add(node, cons("granularity"), literal(ds.granularity, namedNode(XSD_DURATION)));
  add(node, cons("scenario"), cons(ds.scenario === "planned" ? "Planned" : "Actual"));

  // The covered period as a time:Interval (the whole year).
  const interval = blankNode("interval");
  add(node, sosa("phenomenonTime"), interval);
  add(interval, type, namedNode(`${TIME_NS}Interval`));
  add(interval, namedNode(`${TIME_NS}hasBeginning`), literal(`${ds.year}-01-01`, namedNode(XSD_DATE)));
  add(interval, namedNode(`${TIME_NS}hasEnd`), literal(`${ds.year}-12-31`, namedNode(XSD_DATE)));

  if (ds.datasetLocation) {
    // Series descriptor: the daily chunk files are located under this container.
    add(node, cons("datasetLocation"), namedNode(ds.datasetLocation));
  } else {
    // Annual aggregate: one inline sosa:Observation per present metric.
    let i = 0;
    for (
      const [k, v] of Object.entries(ds.metrics ?? {}) as [EnergyMetricKey, number][]
    ) {
      if (v === undefined || v === null) continue;
      const m = ENERGY_METRICS[k];
      const obs = blankNode(`obs${i}`);
      const result = blankNode(`result${i}`);
      i++;
      add(node, sosa("hasMember"), obs);
      add(obs, type, sosa("Observation"));
      add(obs, sosa("observedProperty"), namedNode(m.prop));
      add(obs, sosa("hasResult"), result);
      add(result, sosa("hasSimpleResult"), literal(String(v), namedNode(XSD_DECIMAL)));
      add(result, namedNode(`${SSN_NS}hasUnit`), namedNode(m.unit));
    }
  }

  // Writer.end() invokes its callback synchronously, so `out` is set before return.
  let out = "";
  writer.end((error, result) => {
    if (error) throw error;
    out = result;
  });
  return out;
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
  const units: Partial<Record<EnergyMetricKey, string>> = {};
  for (const member of store.getObjects(ds, namedNode(`${SOSA_NS}hasMember`), null)) {
    const prop =
      store.getObjects(member, namedNode(`${SOSA_NS}observedProperty`), null)[0]
        ?.value;
    const key = prop ? PROP_TO_METRIC[prop] : undefined;
    if (!key) continue;
    const result = store.getObjects(member, namedNode(`${SOSA_NS}hasResult`), null)[0];
    if (!result) continue;
    const val = store.getObjects(result, namedNode(`${SOSA_NS}hasSimpleResult`), null)[0]
      ?.value;
    if (val === undefined) continue;
    const unitIri = store.getObjects(result, namedNode(`${SSN_NS}hasUnit`), null)[0]
      ?.value;
    const canonical = ENERGY_METRICS[key].unit;
    // Normalise to the canonical unit so every downstream calculation is unit-safe; an
    // unrecognised unit is SKIPPED rather than shown as a silently-wrong number.
    const value = toCanonical(Number(val), unitIri, canonical);
    if (value === null) {
      console.warn(`Skipping ${key}: unrecognised unit ${unitIri ?? "(none)"}`);
      continue;
    }
    metrics[key] = value;
    // Keep the original unit only when non-canonical, to display the building's own unit.
    if (unitIri && !sameUnit(unitIri, canonical)) units[key] = unitIri;
  }
  const hasUnits = Object.keys(units).length > 0;
  return {
    building,
    year,
    granularity,
    scenario,
    metrics,
    ...(hasUnits ? { units } : {}),
    featureOfInterest,
  };
}

export type { ObservationRef };
