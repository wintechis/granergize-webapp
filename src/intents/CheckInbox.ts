// Intent core (React-free) for CheckInbox (the hook is `useCheckInbox`). See
// ./README.md for the core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { drainInbox } from "../services/interop/inbox.ts";
import type { Settled } from "./outcomes.ts";

/**
 * React-free core of {@link import("../hooks/mutations.ts").useCheckInbox}: drain
 * the Pod inbox now (archive each pending sharing event into `shared-in/`, then
 * delete the message). Paramless — the inbox is the logged-in user's. `drainInbox`
 * reports no counts, so the outcome is a plain {@link Settled}. The adapter owns
 * the shared-in / received-benchmarks / buildings invalidations.
 */
export async function checkInboxCore(gateway: PodGateway): Promise<Settled> {
  await drainInbox(gateway);
  return { ok: true };
}
