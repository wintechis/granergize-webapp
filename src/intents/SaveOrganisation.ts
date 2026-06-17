// Intent core (React-free) for SaveOrganisation. See ./README.md. The optional
// logo upload is part of the intent's composition — it lives INSIDE the core
// (save the org node, then upload the logo if one was supplied) → {@link Settled}.
import type { PodGateway } from "../services/pod/podGateway.ts";
import {
  type Organization,
  saveOrganization,
  uploadOrgLogo,
} from "../services/organization/organizationManager.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SaveOrganisation intent. */
export interface SaveOrganisationParams {
  /** The organisation fields to write to the WebID profile (opaque, not an IRI). */
  org: Pick<Organization, "name" | "homepage" | "sameAs">;
  /** An optional logo image to upload + link via `foaf:logo` (a real param, opaque). */
  logo?: File | null;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSaveOrganization}:
 * save the organisation node in the WebID profile, then upload the logo when one
 * is supplied (the upload is part of the same intent — domain composition stays in
 * the core). The hook is a thin adapter owning only the `agent`/`agentOrg`
 * invalidations. Takes `gateway` as an argument — no `getSession()`, no React — so
 * it is callable headless.
 */
export async function saveOrganisationCore(
  gateway: PodGateway,
  params: SaveOrganisationParams,
): Promise<Settled> {
  await saveOrganization(gateway, params.org);
  if (params.logo) await uploadOrgLogo(params.logo, gateway);
  return { ok: true };
}
