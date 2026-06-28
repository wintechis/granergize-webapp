/**
 * `SharedWithMe` — a cross-cutting read (`plan-intent-core.md` §8): the buildings
 * shared *with* the viewer, folded from the `shared-in/` log (visibility from prefs).
 * Reads the warm cache when it's hot — the same `["sharingEvent", …]` + `["prefs", …]`
 * entries `useSharedWithMe` uses — and falls back to the fresh `getSharedWithMe` fold
 * when either is cold (headless / before the app read them). Paramless.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  getSharedWithMe,
  sharedWithMeFromGrants,
  type SharedWithMeBuilding,
} from "../../../services/interop/sharing.ts";
import { cachedSharingGrants } from "../../../services/interop/sharingLog.ts";
import { cachedHiddenBuildings } from "../../../services/building/buildingSource.ts";

export function sharedWithMeCore(
  gateway: PodGateway,
): Promise<SharedWithMeBuilding[]> {
  const grants = cachedSharingGrants(gateway.webId, "sharedInContainer");
  const hidden = grants ? cachedHiddenBuildings(gateway.webId) : null;
  if (grants && hidden) {
    return Promise.resolve(sharedWithMeFromGrants(grants, hidden));
  }
  return getSharedWithMe(gateway);
}
