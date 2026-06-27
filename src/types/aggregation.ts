// Aggregation object model — definitions, snapshots, their spatial coordinate, and the
// sharing projection. The vocab-clean fields come from the generated `*Fields`. Reached
// via the `src/types.ts` barrel.
import type {
  AggregationDefinitionFields,
  AggregationSnapshotFields,
} from "../services/rdf/consumptionShape.generated.ts";

export type AggregationType = "average" | "sum" | "min" | "max";

/**
 * The SPATIAL coordinate of an aggregation — the region its members roll up to, distinct from
 * the ad-hoc `buildingUris` extent. `region` is a NUTS/LAU concept IRI (a `skos:Concept` served
 * by the geo wrappers, e.g. `…/ags/09564`); `level` names which hierarchy level it sits at
 * (e.g. "gemeinde", "kreis") — kept general so a non-administrative hierarchy can be named later.
 * Absent on an aggregation over a heterogeneous building set with no single region — such an
 * aggregation falls back to point/centroid rendering on the map guise (plan-aggregations Slice 1).
 */
export interface SpatialExtent {
  region: string; // skos:Concept IRI (the region node)
  level: string; // hierarchy level / which hierarchy
}

// name / aggregationType / period / benchmark / createdAt / lastComputedAt are GENERATED
// (AggregationDefinitionFields, from vocab/consumption.ttl via consumptionConfig). The
// `benchmark` flag is persisted so every (re)compute derives the snapshot's
// :BenchmarkResult typing from it (a refresh can't strip it; the covered year is derived
// at compute time, not stored). Envelope fields below stay hand-written.
export interface AggregationDefinition extends AggregationDefinitionFields {
  id: string;
  buildingUris: string[]; // private — not included in shared snapshots
  metrics: string[]; // e.g., ["gas", "electricity", "solar"]
  /** The region this aggregation covers, when its members roll up to one. */
  spatialExtent?: SpatialExtent;
}

// name / aggregationType / computedAt / buildingCount and the benchmark-result extras
// computedBy / metricPeriod are GENERATED (AggregationSnapshotFields). Envelope below.
export interface AggregationSnapshot extends AggregationSnapshotFields {
  id: string;
  metrics: string[];
  values: Record<string, number>; // metric name → computed value
  /** Additionally typed `:BenchmarkResult` when a benchmark service provider computes
   * this snapshot over the buildings shared to it (then `computedBy`/`metricPeriod` are set). */
  isBenchmark?: boolean;
  /** The region this snapshot covers, when its members roll up to one — recorded IN the
   * snapshot Turtle so a shared snapshot stays self-sufficient (replayable by the recipient). */
  spatialExtent?: SpatialExtent;
}

export interface SharedAggregation {
  aggregationUri: string;
  aggregationId: string;
  sharedWith: string[]; // WebIDs
}
