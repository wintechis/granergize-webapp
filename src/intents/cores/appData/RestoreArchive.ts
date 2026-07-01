// Intent core (React-free) for RestoreArchive. See ./README.md. The restore
// composition belongs to one intent: import the archive bodies, then rebuild
// EVERY derived `.acl` projection the archive doesn't carry — the sharing
// grants by replaying the shared-out log (the ground truth), and the two
// log-less projections (the inbox ACL's sender-append grant, each owned room's
// member ACL) by re-provisioning them where missing. A bespoke outcome
// `{...importResult, reissued}`. The adapter owns the whole-cache
// `qc.invalidateQueries()`.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { type ImportResult, importArchive } from "../../../services/pod/podArchive.ts";
import { reissueGrants } from "../../../services/interop/share.ts";
import { ensureOwnInbox } from "../../../services/interop/inbox.ts";
import { ensureRoomAcls } from "../../../services/interop/dataRoom.ts";

/**
 * RestoreArchive outcome — the import result plus the number of grants reissued
 * (buildings + aggregations) when the shared-out log was replayed. A bespoke shape
 * (not {@link import("./outcomes.ts").Settled}/`Tally`) because the caller renders
 * both the restored count and the reissued count in its tally toast.
 */
export interface RestoreArchiveOutcome extends ImportResult {
  /** Grants rebuilt from the shared-out log (buildings + aggregations). */
  readonly reissued: number;
}

/** Parameters of the RestoreArchive intent. */
export interface RestoreArchiveParams {
  /** The archive ZIP bytes to restore (opaque, not an IRI to resolve). */
  bytes: Uint8Array;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRestoreArchive}:
 * restore an archive into the Pod, then rebuild the ACL projection from the
 * shared-out log (the reconciliation follow-up is part of the restore intent). The
 * hook is a thin adapter owning only the whole-cache `qc.invalidateQueries()`.
 * Takes `gateway` as an argument — no `getSession()`, no React — so it is callable
 * headless.
 */
export async function restoreArchiveCore(
  gateway: PodGateway,
  params: RestoreArchiveParams,
): Promise<RestoreArchiveOutcome> {
  const restore = await importArchive(gateway, params.bytes);
  const reissue = await reissueGrants(gateway);
  // The two ACL projections with no log to replay: the inbox's sender-append
  // grant and each owned room's member ACL. Both converge only-if-missing, so
  // they are safe to run on every restore (idempotent reconciliation).
  await ensureOwnInbox(gateway);
  await ensureRoomAcls(gateway);
  return { ...restore, reissued: reissue.buildings + reissue.aggregations };
}
