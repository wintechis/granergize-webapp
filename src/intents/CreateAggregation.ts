// Intent core (React-free) for CreateAggregation. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { createAggregationDefinition } from "../services/aggregation/aggregationManager.ts";
import { computeAndStoreSnapshot } from "../services/aggregation/aggregationComputer.ts";
import type { AggregationDefinition } from "../types.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the CreateAggregation intent. */
export interface CreateAggregationParams {
  /** The aggregation's display name. */
  name: string;
  /** The IRIs of the member buildings the aggregation spans. */
  buildingUris: string[];
  /** How member metrics are combined (sum/average/…). */
  aggregationType: AggregationDefinition["aggregationType"];
  /** The metric names included in the aggregation. */
  metrics: string[];
  /** Optional reporting period (monthly aggregations). */
  period?: string;
  /** Whether this aggregation is a benchmark (recorded on the definition). */
  benchmark?: boolean;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useCreateAggregation}:
 * create the aggregation definition and compute + store its first snapshot (one
 * user intent). No call site consumes the returned definition (the dialog's
 * `onSuccess` only notifies + closes), so the core returns {@link Settled} rather
 * than the def. The adapter owns the aggregation-definitions invalidation.
 */
export async function createAggregationCore(
  gateway: PodGateway,
  params: CreateAggregationParams,
): Promise<Settled> {
  const def = await createAggregationDefinition(
    gateway,
    params.name,
    params.buildingUris,
    params.aggregationType,
    params.metrics,
    { period: params.period, benchmark: params.benchmark },
  );
  await computeAndStoreSnapshot(gateway, def.id);
  return { ok: true };
}
