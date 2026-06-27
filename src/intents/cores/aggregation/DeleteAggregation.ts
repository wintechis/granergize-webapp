// Intent core (React-free) for DeleteAggregation. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  deleteAggregation,
  getSnapshotUri,
} from "../../../services/aggregation/aggregationManager.ts";
import { revokeAllAggregationRecipients } from "../../../services/interop/sharingManager.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the DeleteAggregation intent. */
export interface DeleteAggregationParams {
  /** The aggregation's id (its definition + snapshot are removed). */
  aggregationId: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteAggregation}:
 * revoke EVERY recipient first (notifying them, so the aggregation drops off
 * their "Aggregations shared with you"), THEN delete the definition/snapshot —
 * deleting the snapshot alone would leave a stale row on each recipient's list,
 * so the ordering is domain logic that stays in the core. The adapter owns the
 * three invalidations.
 */
export async function deleteAggregationCore(
  gateway: PodGateway,
  params: DeleteAggregationParams,
): Promise<Settled> {
  const webId = gateway.webId;
  if (webId) {
    await revokeAllAggregationRecipients(
      getSnapshotUri(webId, params.aggregationId),
      gateway,
    );
  }
  await deleteAggregation(gateway, params.aggregationId);
  return { ok: true };
}
