/**
 * `SharedWithMe` — a cross-cutting read (`plan-intent-core.md` §8): the buildings
 * shared *with* the viewer, folded once from the `shared-in/` log (visibility from
 * prefs). Thin reuse of the existing `getSharedWithMe` fold; paramless.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  getSharedWithMe,
  type SharedWithMeBuilding,
} from "../../../services/interop/sharingManager.ts";

export function sharedWithMeCore(
  gateway: PodGateway,
): Promise<SharedWithMeBuilding[]> {
  return getSharedWithMe(gateway);
}
