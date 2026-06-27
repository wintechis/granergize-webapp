/**
 * `WhoHasAccess` — a relationship read (`plan-intent-core.md` §8): who is a building
 * shared with? Folds the viewer's `shared-out/` event log (ground truth of sharing)
 * and returns the grantee WebIDs for that building. Pure read; the log is the record
 * the WAC `.acl` is derived from, so this is the authoritative "shared with" list.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  type ActiveGrant,
  foldSharingLog,
  sharedOutUri,
} from "../../../services/interop/sharingLog.ts";

export interface WhoHasAccessParams {
  /** The building's resource IRI. */
  buildingUri: string;
}

/** Injectable grants source (defaults to folding the viewer's shared-out log). */
export type LoadOutGrants = (gateway: PodGateway) => Promise<ActiveGrant[]>;
const defaultLoad: LoadOutGrants = (gateway) =>
  foldSharingLog(sharedOutUri(gateway.webId!), gateway);

export async function whoHasAccessCore(
  gateway: PodGateway,
  params: WhoHasAccessParams,
  load: LoadOutGrants = defaultLoad,
): Promise<string[]> {
  if (!gateway.webId) throw new Error("Not logged in.");
  const grants = await load(gateway);
  // Active grants for THIS building → the distinct grantees.
  const grantees = grants
    .filter((g) => g.kind === "Building" && g.resource === params.buildingUri)
    .map((g) => g.grantee);
  return [...new Set(grantees)];
}
