import { CONSUMPTION_NS } from "../vocabularies.ts";

/**
 * Single source of truth for the consumption family's predicate IRIs + the
 * field↔IRI bridges that drive interface generation (see `genVocabInterface.ts`)
 * and the parse/serialize code in `aggregation.ts` / `energyDataset.ts`.
 *
 * Mirrors `buildingConfig.BUILDING_FIELDS`: the app's camelCase key isn't derivable
 * from the IRI local name, so the bridge stays here. Each entry also carries the
 * app-side facts the vocab can't supply — `required` (these records are mostly
 * mandatory, unlike the sparse-optional building fields) and a `tsType` override
 * where the app type is narrower than the vocab range (`aggregationType` is a union;
 * `metricPeriod` is a `gYear` the app keeps as a string). Range/datatype otherwise
 * comes from `vocabSchema.generated.ts`.
 */

/** The consumption predicate IRIs, keyed by vocab local name (one definition each). */
export const CONS = {
  // aggregation (shared :Aggregation + the two subclasses)
  aggregationId: `${CONSUMPTION_NS}aggregationId`,
  aggregationName: `${CONSUMPTION_NS}aggregationName`,
  aggregationType: `${CONSUMPTION_NS}aggregationType`,
  aggregationPeriod: `${CONSUMPTION_NS}aggregationPeriod`,
  benchmark: `${CONSUMPTION_NS}benchmark`,
  createdAt: `${CONSUMPTION_NS}createdAt`,
  lastComputedAt: `${CONSUMPTION_NS}lastComputedAt`,
  computedAt: `${CONSUMPTION_NS}computedAt`,
  buildingCount: `${CONSUMPTION_NS}buildingCount`,
  includesBuilding: `${CONSUMPTION_NS}includesBuilding`,
  includesMetric: `${CONSUMPTION_NS}includesMetric`,
  // energy dataset
  hasEnergyDataset: `${CONSUMPTION_NS}hasEnergyDataset`,
  ofBuilding: `${CONSUMPTION_NS}ofBuilding`,
  datasetLocation: `${CONSUMPTION_NS}datasetLocation`,
  granularity: `${CONSUMPTION_NS}granularity`,
  scenario: `${CONSUMPTION_NS}scenario`,
  // benchmark-result fields (:BenchmarkResult ⊑ :AggregationSnapshot)
  computedBy: `${CONSUMPTION_NS}computedBy`,
  metricPeriod: `${CONSUMPTION_NS}metricPeriod`,
  // class IRIs (rdf:type)
  aggregationDefinitionClass: `${CONSUMPTION_NS}AggregationDefinition`,
  aggregationSnapshotClass: `${CONSUMPTION_NS}AggregationSnapshot`,
  energyDatasetClass: `${CONSUMPTION_NS}EnergyDataset`,
  // :Scenario instances
  scenarioActual: `${CONSUMPTION_NS}Actual`,
  scenarioPlanned: `${CONSUMPTION_NS}Planned`,
} as const;

/** One field of a generated consumption interface. */
export interface ConsumptionField {
  /** The app's TS field name. */
  field: string;
  /** The predicate IRI it maps to. */
  iri: string;
  /** Non-optional in the TS interface (most consumption records are mandatory). */
  required?: boolean;
  /** TS type override where the app type is narrower than the vocab range
   *  (else derived from the property's `vocabSchema` range). */
  tsType?: string;
}

/** `:EnergyDataset`-domained fields carried on `EnergyDatasetRef` (uri/year/featureOfInterest
 *  are derived/SOSA envelope, hand-written). */
export const ENERGY_DATASET_FIELDS: ConsumptionField[] = [
  { field: "granularity", iri: CONS.granularity, required: true },
  { field: "scenario", iri: CONS.scenario, required: true, tsType: "Scenario" },
];

/** `:AggregationDefinition` (+ inherited `:Aggregation`) vocab-clean fields. Envelope
 *  (`id`, `buildingUris`, `metrics`, `spatialExtent`) stays hand-written. */
export const AGGREGATION_DEFINITION_FIELDS: ConsumptionField[] = [
  { field: "name", iri: CONS.aggregationName, required: true },
  { field: "aggregationType", iri: CONS.aggregationType, required: true, tsType: "AggregationKind" },
  { field: "period", iri: CONS.aggregationPeriod },
  { field: "benchmark", iri: CONS.benchmark },
  { field: "createdAt", iri: CONS.createdAt, required: true },
  { field: "lastComputedAt", iri: CONS.lastComputedAt },
];

/** `:AggregationSnapshot` (+ inherited) vocab-clean fields. Envelope (`id`, `metrics`,
 *  `values`, `isBenchmark`, `spatialExtent`) stays hand-written; `computedBy`/`metricPeriod`
 *  are the `:BenchmarkResult` extras. */
export const AGGREGATION_SNAPSHOT_FIELDS: ConsumptionField[] = [
  { field: "name", iri: CONS.aggregationName, required: true },
  { field: "aggregationType", iri: CONS.aggregationType, required: true, tsType: "AggregationKind" },
  { field: "computedAt", iri: CONS.computedAt, required: true },
  { field: "buildingCount", iri: CONS.buildingCount, required: true },
  { field: "computedBy", iri: CONS.computedBy },
  { field: "metricPeriod", iri: CONS.metricPeriod, tsType: "string" },
];
