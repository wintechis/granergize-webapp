// Intent core (React-free) for RemoveAppData. See ./README.md. A long-running,
// cancellable whole-collection wipe: a user cancel resolves as an OUTCOME
// ({@link Aborted} `{aborted: true}`), never an error (mirrors how the hook used
// to treat the abort). The adapter owns the post-wipe `qc.clear()`.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { removeAppData } from "../services/pod/podDelete.ts";
import type { Aborted } from "./outcomes.ts";

/** Parameters of the RemoveAppData intent. */
export interface RemoveAppDataParams {
  /** Optional abort handle (runtime-only — not a modelled RDF param). */
  signal?: AbortSignal;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRemoveAppData}:
 * remove the entire app collection from the Pod. Cancellable — when the supplied
 * signal aborts, the underlying delete rejects and we resolve `{aborted: true}`
 * rather than throw (a user cancel is an outcome). Any other error propagates. The
 * hook is a thin adapter owning only the post-settle `qc.clear()`. Takes `gateway`
 * as an argument — no `getSession()`, no React — so it is callable headless.
 */
export async function removeAppDataCore(
  gateway: PodGateway,
  params: RemoveAppDataParams = {},
): Promise<Aborted> {
  const { signal } = params;
  try {
    await removeAppData(gateway, signal);
  } catch (err) {
    if (signal?.aborted) return { aborted: true };
    throw err;
  }
  return { aborted: false };
}
