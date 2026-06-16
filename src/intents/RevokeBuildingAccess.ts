// Intent core (React-free) for RevokeBuildingAccess (the hook is
// `useRevokeBuildingAccess`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { revokeAccess } from "../services/interop/sharingManager.ts";
import type { Settled } from "./outcomes.ts";

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
  session: Session,
  params: RevokeBuildingAccessParams,
): Promise<Settled> {
  await revokeAccess(params.buildingUri, params.webId, session);
  return { ok: true };
}
