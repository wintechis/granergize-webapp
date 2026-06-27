// Intent core (React-free) for ToggleVisibility. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { toggleBuildingVisibility } from "../../../services/interop/sharingManager.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the ToggleVisibility intent. */
export interface ToggleVisibilityParams {
  /** The shared-in building's IRI whose dashboard visibility is flipped. */
  buildingUri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useToggleVisibility}:
 * flip whether a shared-in building shows in the dashboard (writes `prefs.ttl`).
 * The adapter owns the `prefs` invalidation.
 */
export async function toggleVisibilityCore(
  gateway: PodGateway,
  params: ToggleVisibilityParams,
): Promise<Settled> {
  await toggleBuildingVisibility(params.buildingUri, gateway);
  return { ok: true };
}
