import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDefaultSession } from "@inrupt/solid-client-authn-browser";
import {
  loadBuildingsAndAgents,
  loadEnergy,
} from "../services/TurtleParsingService.ts";
import { resolveStorageRoot } from "../services/utils/solidUtils.ts";
import {
  getSharedBuildings,
  getSharedViews,
  getSharedWithMe,
} from "../services/interop/sharingManager.ts";
import { getViewDefinitions } from "../services/aggregation/viewManager.ts";
import { getOrganization } from "../services/utils/organizationManager.ts";
import type {
  AgentType,
  BuildingType,
  EnergyType,
} from "../../types/types.ts";

/**
 * React Query data hooks. The Solid session is the `getDefaultSession()` singleton
 * (its `fetch` is the authed, activity-instrumented transport); query keys are
 * namespaced by WebID so a re-login doesn't read another user's cache. Error
 * handling (session-expiry / conflict notifications, keep-previous-data) is
 * centralised in `QueryProvider`.
 */

function webIdOf(): string | undefined {
  return getDefaultSession().info.webId ?? undefined;
}

/** Phase 1: buildings + agents (paints the map). */
export function useBuildingsAndAgents() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["buildingsAndAgents", webId],
    enabled: Boolean(webId),
    queryFn: async () => {
      const session = getDefaultSession();
      // Resolve the Pod storage root from pim:storage before any path is built.
      await resolveStorageRoot(session);
      return loadBuildingsAndAgents(session);
    },
  });
}

/** Phase 2: energy for the given buildings (dependent on phase 1). */
export function useEnergy(buildings: BuildingType[] | undefined) {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["energy", webId],
    enabled: Boolean(webId) && Boolean(buildings),
    queryFn: () => loadEnergy(getDefaultSession(), buildings ?? []),
  });
}

export function useSharedWithMe() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedWithMe", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedWithMe(getDefaultSession()),
  });
}

export function useSharedBuildings() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedBuildings", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedBuildings(getDefaultSession()),
  });
}

export function useViewDefinitions() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["viewDefinitions", webId],
    enabled: Boolean(webId),
    queryFn: () => getViewDefinitions(getDefaultSession()),
  });
}

export function useSharedViews() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedViews", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedViews(getDefaultSession()),
  });
}

export function useOrganization() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["organization", webId],
    enabled: Boolean(webId),
    queryFn: () => getOrganization(getDefaultSession()),
  });
}

/** Query keys other modules (mutations) invalidate. */
export const queryKeys = {
  buildingsAndAgents: ["buildingsAndAgents"] as const,
  energy: ["energy"] as const,
  sharedWithMe: ["sharedWithMe"] as const,
  sharedBuildings: ["sharedBuildings"] as const,
  viewDefinitions: ["viewDefinitions"] as const,
  sharedViews: ["sharedViews"] as const,
  organization: ["organization"] as const,
};

/**
 * Back-compat selector returning the legacy `SolidDataContext` shape, now backed
 * by React Query. Existing consumers keep working; new code can call the granular
 * hooks above directly.
 */
export interface SolidData {
  buildings: BuildingType[];
  energyNeed: EnergyType[];
  agents: AgentType[];
  averages: Record<string, number>;
  agentAverages: Record<string, Record<string, number>>;
  isLoading: boolean;
  error: string | null;
  reloadData: () => Promise<void>;
}

export function useSolidData(): SolidData {
  const queryClient = useQueryClient();
  const ba = useBuildingsAndAgents();
  const energy = useEnergy(ba.data?.buildings);

  const err = ba.error ?? energy.error;
  return {
    buildings: ba.data?.buildings ?? [],
    agents: ba.data?.agents ?? [],
    energyNeed: energy.data?.energyNeed ?? [],
    averages: energy.data?.averages ?? {},
    agentAverages: energy.data?.agentAverages ?? {},
    isLoading: ba.isLoading,
    error: err ? (err instanceof Error ? err.message : String(err)) : null,
    reloadData: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.buildingsAndAgents,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.energy });
    },
  };
}
