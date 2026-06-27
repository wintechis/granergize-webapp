// Intent core (React-free) for RevokeAggregationAccess. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { revokeAggregationAccess } from "../../../services/interop/sharing.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the RevokeAggregationAccess intent. */
export interface RevokeAggregationAccessParams {
  /** The aggregation snapshot's IRI whose grant is revoked. */
  snapshotUri: string;
  /** The recipient WebID losing access. */
  webId: string;
}

/**
 * React-free core of
 * {@link import("../hooks/mutations.ts").useRevokeAggregationAccess}: revoke one
 * recipient's access to an aggregation snapshot (records the revocation event +
 * notifies). The adapter owns the shared-out-log invalidation.
 */
export async function revokeAggregationAccessCore(
  gateway: PodGateway,
  params: RevokeAggregationAccessParams,
): Promise<Settled> {
  await revokeAggregationAccess(params.snapshotUri, params.webId, gateway);
  return { ok: true };
}
