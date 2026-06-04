import { useQuery } from "@tanstack/react-query";
import { getSession } from "./session.ts";
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
import { getRoomLogState, readRooms } from "../services/interop/dataRoom.ts";
import type {
  AgentType,
  BuildingType,
  EnergyType,
} from "../../types/types.ts";

/**
 * React Query data hooks. The Solid session is the `getSession()` singleton
 * (its `fetch` is the authed, activity-instrumented transport); query keys are
 * namespaced by WebID so a re-login doesn't read another user's cache. Error
 * handling (session-expiry / conflict notifications, keep-previous-data) is
 * centralised in `QueryProvider`.
 */

function webIdOf(): string | undefined {
  return getSession().info.webId ?? undefined;
}

/** Phase 1: buildings + agents (paints the map). */
export function useBuildingsAndAgents() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["buildingsAndAgents", webId],
    enabled: Boolean(webId),
    queryFn: async () => {
      const session = getSession();
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
    queryFn: () => loadEnergy(getSession(), buildings ?? []),
  });
}

export function useSharedWithMe() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedWithMe", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedWithMe(getSession()),
  });
}

export function useSharedBuildings() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedBuildings", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedBuildings(getSession()),
  });
}

export function useViewDefinitions() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["viewDefinitions", webId],
    enabled: Boolean(webId),
    queryFn: () => getViewDefinitions(getSession()),
  });
}

export function useSharedViews() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["sharedViews", webId],
    enabled: Boolean(webId),
    queryFn: () => getSharedViews(getSession()),
  });
}

/**
 * Data-room registry — `current` + `known`. Owned by the room mutations, which
 * `setQueryData` it authoritatively (see mutations.ts): it is fetched once on
 * load and thereafter never refetched, so a slow/stale read-back can't revert a
 * switch. (Diagnosed: solidcommunity.net/Cloudflare can serve a stale
 * conditional read right after the write — see project memory.)
 */
export function useRooms() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.rooms, webId],
    enabled: Boolean(webId),
    queryFn: () => readRooms(getSession()),
  });
}

/** Members / my-roles / my-membership for one room, keyed on the current room. */
function useRoomLog(current: string | null) {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.roomLog, webId, current],
    enabled: Boolean(webId && current),
    queryFn: () => getRoomLogState(getSession(), current as string),
  });
}

/**
 * Composes the registry ({@link useRooms}) with the current room's log
 * ({@link useRoomLog}) into the shape the Connect tab consumes. The registry is
 * authoritative for `current`/`known`; the log refetches for members/roles.
 */
export function useRoomState() {
  const rooms = useRooms();
  const current = rooms.data?.current ?? null;
  const known = rooms.data?.known ?? [];
  const log = useRoomLog(current);
  return {
    data: rooms.data
      ? {
        current,
        known,
        members: log.data?.members ?? [],
        myRoles: log.data?.myRoles ?? [],
        myMembership: log.data?.myMembership ?? false,
      }
      : undefined,
    isLoading: rooms.isLoading,
    isFetching: rooms.isFetching || log.isFetching,
  };
}

/** Query keys other modules (mutations) invalidate. */
export const queryKeys = {
  buildingsAndAgents: ["buildingsAndAgents"] as const,
  energy: ["energy"] as const,
  sharedWithMe: ["sharedWithMe"] as const,
  sharedBuildings: ["sharedBuildings"] as const,
  viewDefinitions: ["viewDefinitions"] as const,
  sharedViews: ["sharedViews"] as const,
  /** The room registry (current + known). Set via setQueryData, not invalidated. */
  rooms: ["rooms"] as const,
  /** A room's log (members + roles), keyed by room. Invalidated on role saves. */
  roomLog: ["roomLog"] as const,
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
}

export function useSolidData(): SolidData {
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
  };
}
