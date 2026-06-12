import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getSession } from "./session.ts";
import {
  loadBuildings,
  loadEnergy,
  sharedBuildingSourcesFromGrants,
} from "../services/TurtleParsingService.ts";
import { resolveStorageRoot } from "../services/pod/solidUtils.ts";
import {
  foldSharingLog,
  sharedInUrl,
  sharedOutUrl,
} from "../services/interop/sharingLog.ts";
import {
  receivedViewsFromGrants,
  sharedBuildingsFromGrants,
  sharedViewsFromGrants,
  sharedWithMeFromGrants,
} from "../services/interop/sharingManager.ts";
import { readPrefs } from "../services/prefs.ts";
import {
  getComputedSnapshotByViewId,
  getReceivedBenchmarksFor,
  getViewDefinition,
  getViewDefinitions,
} from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import { getRoomLogState, readRooms } from "../services/interop/dataRoom.ts";
import { readContacts } from "../services/contacts.ts";
import {
  resolveAgent,
  resolveAgentOrg,
} from "../services/agents/agentResolver.ts";
import {
  type EnergyDatasetRef,
  listSeriesDays,
  loadEnergyDatasets,
} from "../services/rdf/energyDataset.ts";
import { parseTtlReadings } from "../services/rdf/userEnergyParser.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { fetchFresh } from "../services/pod/podFetch.ts";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
  AnnualData,
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

/**
 * The folded `shared-in/` log — THE one fold per load. Everything "shared with
 * me" (shared building sources, the Share-tab list, received views, received
 * benchmarks) derives from this query's data instead of folding the log again;
 * with N events a fold costs a container listing + N GETs, so the dedup is the
 * difference between 1× and 4× that per load.
 */
export function useSharedInGrants() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.sharedInLog, webId],
    enabled: Boolean(webId),
    queryFn: () => foldSharingLog(sharedInUrl(webId as string), getSession()),
  });
}

/** The folded `shared-out/` log — see {@link useSharedInGrants}; the
 * shared-buildings and shared-views lists derive from it. */
export function useSharedOutGrants() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.sharedOutLog, webId],
    enabled: Boolean(webId),
    queryFn: () => foldSharingLog(sharedOutUrl(webId as string), getSession()),
  });
}

/** `prefs.ttl` (hidden buildings, …). Invalidated by the visibility toggle. */
export function usePrefs() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.prefs, webId],
    enabled: Boolean(webId),
    queryFn: () => readPrefs(getSession()),
  });
}

/**
 * Phase 1: buildings (paints the map). Dependent on the folded `shared-in/`
 * log (the shared building sources come from its grants) AND on the `prefs`
 * query (the hidden-building set the load filters by) — so neither resource is
 * fetched twice per load. The key carries the sorted source list and the hidden
 * fingerprint, so a share arriving/leaving or a visibility toggle refetches
 * buildings because the data changed. A FAILED dependency degrades (no shared
 * sources / nothing hidden) rather than blocking own buildings.
 */
export function useBuildings() {
  const webId = webIdOf();
  const qc = useQueryClient();
  const log = useSharedInGrants();
  const prefs = usePrefs();
  const sharedSources = log.data
    ? sharedBuildingSourcesFromGrants(log.data).sort()
    : log.isError
    ? []
    : undefined;
  const hidden = prefs.data
    ? prefs.data.hiddenBuildings
    : prefs.isError
    ? new Set<string>()
    : undefined;
  return useQuery({
    queryKey: [
      ...queryKeys.buildings,
      webId,
      (sharedSources ?? []).join(";"),
      [...(hidden ?? [])].sort().join(";"),
    ],
    enabled: Boolean(webId) && sharedSources !== undefined &&
      hidden !== undefined,
    queryFn: async () => {
      const session = getSession();
      // Resolve the Pod storage root from pim:storage before any path is built.
      await resolveStorageRoot(session);
      const { buildings, prunedSources } = await loadBuildings(
        session,
        sharedSources ?? [],
        hidden ?? new Set(),
      );
      // An inaccessible shared source was pruned (a self-revocation appended to
      // shared-in/): refold the log so the grant set — and every reader derived
      // from it, incl. this query's own key — drops the revoked source.
      if (prunedSources.length > 0) {
        qc.invalidateQueries({ queryKey: queryKeys.sharedInLog });
      }
      return { buildings };
    },
  });
}

/** Phase 2: energy for the given buildings (dependent on phase 1).
 *
 * The key fingerprints what `loadEnergy` actually reads: each building's id PLUS
 * its `cons:hasEnergyDataset` links (year/granularity/scenario per dataset). Keying
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
 * `cons:hasEnergyDataset` links (year/granularity/scenario), so the key changes
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
    queryKey: [...queryKeys.energy, webId, energyKey],
    enabled: Boolean(webId) && Boolean(buildings),
    queryFn: () => loadEnergy(getSession(), buildings ?? []),
  });
}

// The sharing lists below are pure in-memory derivations of the two folded
// logs (+ prefs), composed in the `useRoomState` style: `{ data, isLoading,
// isFetching, error }` over the underlying queries — no fetch of their own.

/** Buildings shared WITH the user (Share tab), from shared-in grants + prefs. */
export function useSharedWithMe() {
  const log = useSharedInGrants();
  const prefs = usePrefs();
  const data = useMemo(
    () =>
      log.data && prefs.data
        ? sharedWithMeFromGrants(log.data, prefs.data.hiddenBuildings)
        : undefined,
    [log.data, prefs.data],
  );
  return {
    data,
    isLoading: log.isLoading || prefs.isLoading,
    isFetching: log.isFetching || prefs.isFetching,
    error: log.error ?? prefs.error,
  };
}

/** Buildings the user has shared with others, from shared-out grants. */
export function useSharedBuildings() {
  const log = useSharedOutGrants();
  const data = useMemo(
    () => (log.data ? sharedBuildingsFromGrants(log.data) : undefined),
    [log.data],
  );
  return {
    data,
    isLoading: log.isLoading,
    isFetching: log.isFetching,
    error: log.error,
  };
}

export function useViewDefinitions() {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.viewDefinitions, webId],
    enabled: Boolean(webId),
    queryFn: () => getViewDefinitions(getSession()),
  });
}

export interface ViewDetail {
  definition: AggregatedViewDefinition | null;
  snapshot: AggregatedViewSnapshot | null;
  /** Set when the snapshot auto-materialise failed; the page surfaces it inline. */
  computeError?: unknown;
}

/**
 * One view's standalone-page data (/view/:id): definition + computed snapshot,
 * keyed by view id. A definition without a snapshot — a freshly created view —
 * is auto-materialised here so the chart renders immediately instead of an
 * empty "Refresh Snapshot" prompt: a reconciliation write inside a read path
 * (a documented seam — notes/queries-mutations.md §Seams). Best-effort: a
 * failed compute travels in `computeError` and the read still succeeds with
 * the definition (Refresh is the retry affordance). Safe to key the write on a
 * null snapshot: loadComputedSnapshot returns null ONLY for genuine absence
 * (404) and THROWS on transient failures, so a failed read of an EXISTING
 * snapshot can never trigger it. Invalidated by the refresh-view and
 * delete-view mutations.
 */
export function useViewDetail(viewId: string | undefined) {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.viewDetail, webId, viewId],
    enabled: Boolean(webId && viewId),
    queryFn: async (): Promise<ViewDetail> => {
      const session = getSession();
      const id = viewId as string;
      const [definition, snapshot] = await Promise.all([
        getViewDefinition(session, id),
        getComputedSnapshotByViewId(session, id),
      ]);
      if (!definition || snapshot) return { definition, snapshot };
      try {
        const { snapshot: computed } = await refreshSnapshot(session, id);
        // Re-read the definition so lastComputedAt reflects the compute.
        const updated = await getViewDefinition(session, id);
        return { definition: updated ?? definition, snapshot: computed };
      } catch (computeError) {
        return { definition, snapshot: null, computeError };
      }
    },
  });
}

/** Views the user has shared with others, from shared-out grants. */
export function useSharedViews() {
  const log = useSharedOutGrants();
  const data = useMemo(
    () => (log.data ? sharedViewsFromGrants(log.data) : undefined),
    [log.data],
  );
  return {
    data,
    isLoading: log.isLoading,
    isFetching: log.isFetching,
    error: log.error,
  };
}

/** Aggregated views shared *with* the current user, from shared-in grants. */
export function useReceivedViews() {
  const log = useSharedInGrants();
  const data = useMemo(
    () => (log.data ? receivedViewsFromGrants(log.data) : undefined),
    [log.data],
  );
  return {
    data,
    isLoading: log.isLoading,
    isFetching: log.isFetching,
    error: log.error,
  };
}

/**
 * The benchmark snapshots received from a BSP (the subset of received views
 * marked as a benchmark result). The energy view compares the owner's own
 * figures against these. Loads each received snapshot, so it stays a real
 * query — but DEPENDENT on the folded shared-in log (no second fold), keyed
 * on the received-snapshot URLs so a grant arriving/leaving refetches because
 * the data changed. The plain `receivedBenchmarks` prefix invalidation (inbox
 * drain) still matches — snapshot CONTENTS can change with the grant set
 * unchanged.
 */
export function useReceivedBenchmarks() {
  const webId = webIdOf();
  const log = useSharedInGrants();
  const received = useMemo(
    () => (log.data ? receivedViewsFromGrants(log.data) : undefined),
    [log.data],
  );
  const fingerprint = (received ?? []).map((r) => r.snapshotUrl).sort().join(";");
  return useQuery({
    queryKey: [...queryKeys.receivedBenchmarks, webId, fingerprint],
    enabled: Boolean(webId) && received !== undefined,
    queryFn: () => getReceivedBenchmarksFor(getSession(), received ?? []),
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

/** The `fetchFresh` transport as the parsers' `fetchFn` shape. */
function freshFetchFn(): (url: string) => Promise<Response> {
  const session = getSession();
  return (url) => fetchFresh(url, session);
}

/**
 * One building's annual (non-series) energy datasets, split by scenario and
 * sorted by year — what the detail pane's annual view renders. Keyed on the
 * dataset-link fingerprint (`energyKeyFor`), so saving/deleting an energy year
 * refetches because the *data* changed, not because the view remembered to;
 * content-only edits (same links) are covered by the explicit invalidation in
 * `useInvalidateBuildingData`.
 */
export function useAnnualEnergy(building: BuildingType) {
  const webId = webIdOf();
  return useQuery({
    queryKey: [
      ...queryKeys.annualEnergy,
      webId,
      building.id,
      energyKeyFor([building]),
    ],
    enabled: Boolean(webId),
    queryFn: async () => {
      const refs = (building.energyDatasets ?? []).filter(
        (r) => !isSeriesGranularity(r.granularity),
      );
      const datasets = await loadEnergyDatasets(refs, freshFetchFn());
      const rows = (scenario: "actual" | "planned") =>
        datasets
          .filter((d) => d.scenario === scenario && d.metrics)
          .map((d) => ({ year: d.year, ...d.metrics }) as AnnualData)
          .sort((a, b) => a.year - b.year);
      return { actual: rows("actual"), planned: rows("planned") };
    },
  });
}

/**
 * The day files behind a set of 15-minute series descriptors (one listing per
 * ref, concurrent), merged and sorted by day. Feeds the user-energy chart's
 * date/month pickers and the create-view dialog's month list (months are a
 * cheap `day.substring(0, 7)` derivation at the call site).
 */
export function useSeriesDays(refs: EnergyDatasetRef[]) {
  const webId = webIdOf();
  const refKey = refs.map((r) => r.url).sort().join(";");
  return useQuery({
    queryKey: [...queryKeys.seriesDays, webId, refKey],
    enabled: Boolean(webId) && refs.length > 0,
    queryFn: async () => {
      const session = getSession();
      const perRef = await Promise.all(
        refs.map((ref) => listSeriesDays(session, ref)),
      );
      return perRef.flat().sort((a, b) => a.day.localeCompare(b.day));
    },
  });
}

/** One day file's 15-minute readings; disabled until a date is picked. */
export function useDayReadings(url: string | undefined) {
  const webId = webIdOf();
  return useQuery({
    queryKey: [...queryKeys.dayReadings, webId, url],
    enabled: Boolean(webId && url),
    queryFn: () => parseTtlReadings(url as string, freshFetchFn()),
  });
}

/**
 * A month of day files at once, as `Map<day, readings>` — unreadable days are
 * skipped (`allSettled`), matching the chart's previous tolerance. `enabled`
 * gates it to the monthly tabs so the bulk fetch never runs for the day view.
 */
export function useMonthReadings(
  entries: { day: string; url: string }[],
  enabled: boolean,
) {
  const webId = webIdOf();
  const entryKey = entries.map((e) => e.url).join(";");
  return useQuery({
    queryKey: [...queryKeys.monthReadings, webId, entryKey],
    enabled: Boolean(webId) && enabled && entries.length > 0,
    queryFn: async () => {
      const fetchFn = freshFetchFn();
      const result = new Map<string, Array<{ begin: string; value: number }>>();
      const settled = await Promise.allSettled(
        entries.map((e) =>
          parseTtlReadings(e.url, fetchFn).then((data) => ({
            day: e.day,
            data,
          }))
        ),
      );
      for (const r of settled) {
        if (r.status === "fulfilled") result.set(r.value.day, r.value.data);
      }
      return result;
    },
  });
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
 * Resolve a single WebID to its organisation — name + logo IRI — (read from the
 * agent's own profile via `org:memberOf` → `foaf:name`/`foaf:logo`). Per-WebID
 * keyed and cached; disabled until a WebID is given. Resolution never throws —
 * a private/unreachable profile or an org-less agent resolves to `null`.
 */
export function useResolveOrg(webId?: string) {
  return useQuery({
    queryKey: [...queryKeys.agentOrg, webId],
    enabled: Boolean(webId),
    queryFn: () => resolveAgentOrg(webId as string, getSession()),
  });
}

/**
 * Query-key prefixes — the single source for the hooks above AND the mutation
 * invalidations (mutations.ts), so the invalidation contract can't drift on a
 * key typo.
 */
export const queryKeys = {
  buildings: ["buildings"] as const,
  energy: ["energy"] as const,
  /** The folded `shared-in/` log — everything "shared with me" derives from it. */
  sharedInLog: ["sharedInLog"] as const,
  /** The folded `shared-out/` log — the shared-buildings/-views lists derive from it. */
  sharedOutLog: ["sharedOutLog"] as const,
  /** prefs.ttl (hidden buildings, …). Invalidated by the visibility toggle. */
  prefs: ["prefs"] as const,
  viewDefinitions: ["viewDefinitions"] as const,
  /** One view's definition + computed snapshot (the standalone /view page), keyed by view id. */
  viewDetail: ["viewDetail"] as const,
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
  /** A single resolved agent's organisation (name + logo IRI), keyed by WebID. */
  agentOrg: ["agentOrg"] as const,
  /** One building's annual datasets (detail pane), keyed by id + link fingerprint. */
  annualEnergy: ["annualEnergy"] as const,
  /** Day files behind a set of 15-min series descriptors, keyed by ref URLs. */
  seriesDays: ["seriesDays"] as const,
  /** One day file's readings, keyed by URL. */
  dayReadings: ["dayReadings"] as const,
  /** A month of day files (bulk), keyed by the entry URLs. */
  monthReadings: ["monthReadings"] as const,
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
