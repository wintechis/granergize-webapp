// Intent core (React-free) for RemoveAppData. See ./README.md. A long-running,
// cancellable whole-collection wipe: a user cancel resolves as an OUTCOME
// ({@link Aborted} `{aborted: true}`), never an error (mirrors how the hook used
// to treat the abort). The adapter owns the post-wipe `qc.clear()`.
import type { Session } from "@inrupt/solid-client-authn-browser";
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
 * hook is a thin adapter owning only the post-settle `qc.clear()`. Takes `session`
 * as an argument — no `getSession()`, no React — so it is callable headless.
 */
export async function removeAppDataCore(
  session: Session,
  params: RemoveAppDataParams = {},
): Promise<Aborted> {
  const { signal } = params;
  try {
    await removeAppData(session, signal);
  } catch (err) {
    if (signal?.aborted) return { aborted: true };
    throw err;
  }
  return { aborted: false };
}
