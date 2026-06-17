// Intent core (React-free) for ShareAggregation (the hook is
// `useShareAggregationSnapshot`). See ./README.md for the core/adapter split and
// the write→outcome convention. Mirrors `shareBuildingCore`'s per-recipient loop.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { shareAggregation } from "../services/interop/share.ts";
import type { Tally } from "./outcomes.ts";

/** Parameters of the ShareAggregation intent. */
export interface ShareAggregationParams {
  /** The aggregation snapshot's IRI to grant read access to. */
  snapshotUri: string;
  /** WebIDs to grant read access to; shared sequentially. */
  recipients: string[];
}

/**
 * React-free core of
 * {@link import("../hooks/mutations.ts").useShareAggregationSnapshot}: grant each
 * recipient read access to an aggregation snapshot (records the grant event,
 * applies the ACL, notifies each inbox). Sequential; stops at the first failure
 * (recipients already granted stay granted). Returns a per-recipient tally.
 *
 * The hook keeps only busy state, the central toast / inline `<Alert>`
 * (`meta.silent` is an adapter concern — the core knows nothing about it), and
 * the `sharedOutLog` invalidation.
 */
export async function shareAggregationCore(
  gateway: PodGateway,
  params: ShareAggregationParams,
): Promise<Tally> {
  const total = params.recipients.length;
  let done = 0;
  for (const recipient of params.recipients) {
    await shareAggregation(params.snapshotUri, recipient, gateway);
    done++;
  }
  return { done, total };
}
