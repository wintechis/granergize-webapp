// Intent core (React-free) for ExportArchive — an imperative READ-intent. See
// ./README.md: a read core returns its VALUE (here the archive blob + count),
// never an outcome.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { exportArchive, type ExportResult } from "../services/pod/podArchive.ts";

/**
 * The read's value type. Re-exported here so the value type lives with the core
 * (the core is the single entry point a headless caller binds against); it is
 * defined where the archive is packed ({@link exportArchive}).
 */
export type { ExportResult };

/**
 * Parameters of the ExportArchive intent. The export is collection-wide — it
 * takes no modelled (RDF) params (`INTENT_PARAMS.ExportArchive` is empty); the
 * `signal` is a runtime-only abort handle, never a modelled param.
 */
export interface ExportArchiveParams {
  /** Optional abort handle (runtime-only — not a modelled RDF param). */
  signal?: AbortSignal;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useExportArchive}:
 * fetch every resource under the app collection and pack it into a ZIP, returning
 * the bytes + resource count. No writes — a pure read whose whole point is the
 * returned value. This gives `query()` a non-paramless read so the read channel's
 * param→value path is exercised (`AuditGrants` alone is paramless).
 *
 * The hook is a thin adapter owning only busy state + the central toast (no
 * invalidation: CQS forbids a read declaring one). Takes `gateway` as an
 * argument — no `getSession()`, no React — so it is callable headless.
 */
export function exportArchiveCore(
  gateway: PodGateway,
  params: ExportArchiveParams = {},
): Promise<ExportResult> {
  return exportArchive(gateway, params.signal);
}
