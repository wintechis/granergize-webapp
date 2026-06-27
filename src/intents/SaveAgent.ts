// Intent core (React-free) for SaveAgent. See ./README.md for the core/adapter
// split and the write→outcome convention. A plain in-place write → {@link Settled}.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { saveAgent, type SavedAgent } from "../services/savedAgents.ts";
import { uploadAgentLogo } from "../services/agents/agentLogo.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SaveAgent intent. */
export interface SaveAgentParams {
  /** The agent to add or update in the address book (opaque, not an IRI to resolve). */
  agent: SavedAgent;
  /** An organisation agent's logo image to upload to the user's Pod before the
   *  write; its public URI becomes the agent's `vcard:logo`. */
  logo?: File | null;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSaveAgent}:
 * add (or update) an agent in the address book. A plain write — the hook is a
 * thin adapter owning only the `agents` invalidation. Takes a {@link PodGateway}
 * (the authed transport + identity) — no `getSession()`, no React — so it is
 * callable headless; a `Session` satisfies the gateway, so the hook passes
 * `getSession()` unchanged.
 */
export async function saveAgentCore(
  gateway: PodGateway,
  params: SaveAgentParams,
): Promise<Settled> {
  // A picked logo is uploaded first (to the user's own Pod, public-read); its URI
  // becomes the agent's vcard:logo. The agent's own profile is never touched.
  const logoUrl = params.logo
    ? await uploadAgentLogo(params.logo, params.agent.webId, gateway)
    : params.agent.logoUrl;
  await saveAgent(gateway, { ...params.agent, logoUrl });
  return { ok: true };
}
