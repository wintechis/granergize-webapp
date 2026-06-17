// Intent core (React-free) for ReissueGrants (the hook is `useReissueGrants`).
// See ./README.md for the core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { reissueGrants, type ReissueResult } from "../services/interop/share.ts";

/**
 * React-free core of {@link import("../hooks/mutations.ts").useReissueGrants}:
 * rebuild the WAC `.acl` projection from the `shared-out/` event log — a
 * materialized-projection reconciliation. Paramless — the rebuild is
 * collection-wide. Returns the {@link ReissueResult} counts (a bespoke outcome,
 * the audit/repair figures the dialog can surface). The adapter has no
 * invalidations: it writes only the ACL projection, which no query reads.
 */
export async function reissueGrantsCore(gateway: PodGateway): Promise<ReissueResult> {
  return await reissueGrants(gateway);
}
