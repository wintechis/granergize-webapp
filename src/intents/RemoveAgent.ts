// Intent core (React-free) for RemoveAgent. See ./README.md. A plain in-place
// write → {@link Settled}.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { removeAgent } from "../services/savedAgents.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the RemoveAgent intent. */
export interface RemoveAgentParams {
  /** The contact's WebID to drop from the address book. */
  webId: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRemoveAgent}:
 * remove a contact from the address book. A plain write — the hook is a thin
 * adapter owning only the `contacts` invalidation. Takes `gateway` as an
 * argument — no `getSession()`, no React — so it is callable headless.
 */
export async function removeAgentCore(
  gateway: PodGateway,
  params: RemoveAgentParams,
): Promise<Settled> {
  await removeAgent(gateway, params.webId);
  return { ok: true };
}
