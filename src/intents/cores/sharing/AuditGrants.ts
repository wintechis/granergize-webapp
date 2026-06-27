// Intent core (React-free) for AuditGrants — an imperative READ-intent. See
// ./README.md: a read core returns its VALUE (here the drift report), never an
// outcome.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { auditGrants, type GrantAuditResult } from "../../../services/interop/share.ts";

/**
 * The read's value type. Re-exported here so the value type lives with the core
 * (the core is the single entry point a headless caller binds against); it is
 * defined where the audit is computed ({@link auditGrants}).
 */
export type { GrantAuditResult };

/**
 * React-free core of {@link import("../hooks/mutations.ts").useAuditGrants}:
 * dry-run diff of the WAC `.acl` projection against the `shared-out/` log,
 * returning the drift report. No writes — a pure read whose whole point is the
 * returned value.
 *
 * The hook is a thin adapter owning only busy state + the central toast (no
 * invalidation: CQS forbids a read declaring one). Takes `gateway` as an
 * argument — no `getSession()`, no React — so it is callable headless.
 */
export function auditGrantsCore(
  gateway: PodGateway,
): Promise<GrantAuditResult> {
  return auditGrants(gateway);
}
