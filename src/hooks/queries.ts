import { useQuery } from "@tanstack/react-query";
import { getSession } from "./session.ts";
import {
  loadBuildings,
  loadEnergy,
} from "../services/TurtleParsingService.ts";
import { resolveStorageRoot } from "../services/pod/solidUtils.ts";
import {
  getReceivedViews,
  getSharedBuildings,
  getSharedViews,
  getSharedWithMe,
} from "../services/interop/sharingManager.ts";
import {
  getReceivedBenchmarks,
  getViewDefinitions,
} from "../services/aggregation/viewManager.ts";
import { getRoomLogState, readRooms } from "../services/interop/dataRoom.ts";
import { readContacts } from "../services/contacts.ts";
import {
  resolveAgent,
  resolveAgentOrgLogo,
} from "../services/agents/agentResolver.ts";
import type {
  BuildingType,
  EnergyType,
} from "../types.ts";

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

/** Phase 1: buildings (paints the map). */
export function useBuildings() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["buildings", webId],
    enabled: Boolean(webId),
    queryFn: async () => {
      const session = getSession();
      // Resolve the Pod storage root from pim:storage before any path is built.
      await resolveStorageRoot(session);
      return loadBuildings(session);
    },
  });
}

/** Phase 2: energy for the given buildings (dependent on phase 1).
 *
 * The key fingerprints what `loadEnergy` actually reads: each building's id PLUS
 * its `gran:hasEnergyDataset` links (year/granularity/scenario per dataset). Keying
 * on the id set alone under-covers the inputs — energy is folded from per-building
 * dataset links, so a building that merely *gains* or *loses* a link (an energy year
 * written/deleted on an existing building) leaves the id set unchanged, the key
 * unchanged, and the bulk energy stale until something else invalidates it. That bit
 * the map energy lens, whose categorisation wants every building's current energy at
 * once right after a write (see `notes/query-key-coverage.md`). Folding the link
 * fingerprint in makes the refetch fall out of the data, not out of each mutation
 * remembering to invalidate. (It also still AUTO-refetches when the building set
 * changes — e.g. the demo seed adding buildings.) `queryKeys.energy` (`["energy"]`)
 * still prefix-matches this key, so existing invalidations keep working. */
/**
 * The energy query's content fingerprint: each building's id PLUS its
 * `gran:hasEnergyDataset` links (year/granularity/scenario), so the key changes
 * whenever a dataset link is added/removed — not only when the building set does.
 * Exported (and pure) so the coverage is unit-testable.
 */
export function energyKeyFor(buildings: BuildingType[] | undefined): string {
  return (buildings ?? [])
    .map((b) => {
      const datasets = (b.energyDatasets ?? [])
        .map((d) => `${d.year}-${d.granularity}-${d.scenario}`)
        .sort()
        .join(",");
      return `${b.id}#${datasets}`;
    })
    .sort()
    .join(";");
}

export function useEnergy(buildings: BuildingType[] | undefined) {
  const webId = webIdOf();
  const energyKey = energyKeyFor(buildings);
  return useQuery({
    queryKey: ["energy", webId, energyKey],
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

/** Aggregated views shared *with* the current user (folds `shared-in/`). */
export function useReceivedViews() {
  const webId = webIdOf();
  return useQuery({
    queryKey: ["receivedViews", webId],
    enabled: Boolean(webId),
    queryFn: () => getReceivedViews(getSession()),
  });
}

/**
 * The benchmark snapshots received from a BSP (the subset of received views marked
 * as a benchmark result). The energy view compares the owner's own figures against
 * these. Loads each received snapshot, so it sits behind its own query key.
 */
export function useReceivedBenchmarks() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.receivedBenchmarks, webId],
    enabled: Boolean(webId),
    queryFn: () => getReceivedBenchmarks(getSession()),
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
    // The room registry is managed optimistically (mutations patch the cache);
    // unlike the rest of the app's staleTime:0 + conditional-GET freshness, it
    // must NOT auto-refetch — a background refetch could revert an in-flight
    // optimistic room switch. Encode that invariant rather than relying on the
    // absence of an invalidation.
    staleTime: Infinity,
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

// One stable empty array for the `?? []` fallbacks below. A fresh `[]` per render
// makes the derived `members`/`myRoles`/`known` new references every render; any
// consumer using one as a useEffect/useMemo dependency then re-runs every render
// — an infinite loop. ConnectPage's role-sync effect hit exactly this when there
// was no active room (current=null → log.data undefined → myRoles a new []).
const EMPTY_LIST = Object.freeze([]) as never[];

/**
 * Composes the registry ({@link useRooms}) with the current room's log
 * ({@link useRoomLog}) into the shape the Connect tab consumes. The registry is
 * authoritative for `current`/`known`; the log refetches for members/roles.
 */
export function useRoomState() {
  const rooms = useRooms();
  const current = rooms.data?.current ?? null;
  const known = rooms.data?.known ?? EMPTY_LIST;
  const log = useRoomLog(current);
  return {
    data: rooms.data
      ? {
        current,
        known,
        members: log.data?.members ?? EMPTY_LIST,
        myRoles: log.data?.myRoles ?? EMPTY_LIST,
        myMembership: log.data?.myMembership ?? false,
      }
      : undefined,
    isLoading: rooms.isLoading,
    isFetching: rooms.isFetching || log.isFetching,
  };
}

/** The personal contacts address book (folds contacts.ttl). */
export function useContacts() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.contacts, webId],
    enabled: Boolean(webId),
    queryFn: () => readContacts(getSession()),
  });
}

/**
 * Resolve a single WebID to its display name + avatar (read from the agent's own
 * profile). Per-WebID keyed and cached; disabled until a WebID is given. Resolution
 * never throws, so a private/unreachable profile resolves to `{ webId, name:
 * #fragment }` rather than erroring.
 */
export function useResolveAgent(webId?: string) {
  return useQuery({
    queryKey: [...queryKeys.agent, webId],
    enabled: Boolean(webId),
    queryFn: () => resolveAgent(webId as string, getSession()),
  });
}

/**
 * Resolve a single WebID to its organisation's logo IRI (read from the agent's
 * own profile via `org:memberOf` → `foaf:logo`). Per-WebID keyed and cached;
 * disabled until a WebID is given. Resolution never throws — a private/
 * unreachable profile or a logo-less org resolves to `null`.
 */
export function useResolveOrgLogo(webId?: string) {
  return useQuery({
    queryKey: [...queryKeys.agentLogo, webId],
    enabled: Boolean(webId),
    queryFn: () => resolveAgentOrgLogo(webId as string, getSession()),
  });
}

/** Query keys other modules (mutations) invalidate. */
export const queryKeys = {
  buildings: ["buildings"] as const,
  energy: ["energy"] as const,
  sharedWithMe: ["sharedWithMe"] as const,
  sharedBuildings: ["sharedBuildings"] as const,
  viewDefinitions: ["viewDefinitions"] as const,
  sharedViews: ["sharedViews"] as const,
  receivedViews: ["receivedViews"] as const,
  /** Benchmark snapshots received from a BSP (subset of received views). */
  receivedBenchmarks: ["receivedBenchmarks"] as const,
  /** The room registry (current + known). Set via setQueryData, not invalidated. */
  rooms: ["rooms"] as const,
  /** A room's log (members + roles), keyed by room. Invalidated on role saves. */
  roomLog: ["roomLog"] as const,
  /** The contacts address book. Invalidated on save/remove. */
  contacts: ["contacts"] as const,
  /** A single resolved agent (name/avatar), keyed by WebID. */
  agent: ["agent"] as const,
  /** A single resolved agent's org logo IRI, keyed by WebID. */
  agentLogo: ["agentLogo"] as const,
};

/**
 * Back-compat selector returning the legacy `SolidDataContext` shape, now backed
 * by React Query. Existing consumers keep working; new code can call the granular
 * hooks above directly.
 */
export interface SolidData {
  buildings: BuildingType[];
  energyNeed: EnergyType[];
  averages: Record<string, number>;
  portfolioAverages: Record<string, number>;
  operatorAverages: Record<string, Record<string, number>>;
  isLoading: boolean;
  error: string | null;
}

export function useSolidData(): SolidData {
  const ba = useBuildings();
  const energy = useEnergy(ba.data?.buildings);

  const err = ba.error ?? energy.error;
  return {
    buildings: ba.data?.buildings ?? [],
    energyNeed: energy.data?.energyNeed ?? [],
    averages: energy.data?.averages ?? {},
    portfolioAverages: energy.data?.portfolioAverages ?? {},
    operatorAverages: energy.data?.operatorAverages ?? {},
    isLoading: ba.isLoading,
    error: err ? (err instanceof Error ? err.message : String(err)) : null,
  };
}
