// Intent core (React-free) for RevokeBuildingAccess (the hook is
// `useRevokeBuildingAccess`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { revokeAccess } from "../../../services/interop/sharing.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the RevokeBuildingAccess intent. */
export interface RevokeBuildingAccessParams {
  /** The building's IRI whose grant is revoked. */
  buildingUri: string;
  /** The recipient WebID losing access. */
  webId: string;
}

/**
 * React-free core of
 * {@link import("../hooks/mutations.ts").useRevokeBuildingAccess}: revoke one
 * recipient's access to one of your buildings (records the revocation event,
 * withdraws the ACL, notifies). The adapter owns the shared-out-log invalidation.
 */
export async function revokeBuildingAccessCore(
  gateway: PodGateway,
  params: RevokeBuildingAccessParams,
): Promise<Settled> {
  await revokeAccess(params.buildingUri, params.webId, gateway);
  return { ok: true };
}
