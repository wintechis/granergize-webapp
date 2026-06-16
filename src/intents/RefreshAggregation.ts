// Intent core (React-free) for RefreshAggregation. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { refreshSnapshot } from "../services/aggregation/aggregationComputer.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the RefreshAggregation intent. */
export interface RefreshAggregationParams {
  /** The aggregation's id (its snapshot is recomputed in place). */
  aggregationId: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRefreshAggregation}:
 * recompute + re-store the aggregation's snapshot from current member data. The
 * adapter owns the definitions + detail invalidations.
 */
export async function refreshAggregationCore(
  session: Session,
  params: RefreshAggregationParams,
): Promise<Settled> {
  await refreshSnapshot(session, params.aggregationId);
  return { ok: true };
}
