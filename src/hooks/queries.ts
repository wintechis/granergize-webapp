import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PodGateway } from "../services/pod/podGateway.ts";
import { getGateway, getSession } from "./session.ts";
import {
  listOwnBuildings,
  loadBuildinglessObservations,
  removeInaccessibleBuildingSources,
  SessionExpiredError,
  sharedBuildingSourcesFromGrants,
} from "../services/turtleParsing.ts";
import {
  BuildingSourceError,
  loadBuildingSource,
} from "../services/building/buildingSource.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { logError } from "../lib/logError.ts";
import {
  buildingEnergyKeyFor,
  computeEnergyAverages,
  resolveBuildingEnergy,
  resolveBuildingEnergyByYear,
} from "../services/energy/buildingEnergy.ts";
import {
  getStorageRoot,
  podResources,
  resolveStorageRoot,
} from "../services/pod/solidUtils.ts";
import { listDirectChildren } from "../services/pod/podDelete.ts";
import {
  type ActiveGrant,
  foldEvents,
  grantsFromEvents,
  listLogEvents,
  loadSharingEvent,
  type SharingEvent,
  sharedInUri,
  sharedOutUri,
} from "../services/interop/sharingLog.ts";
import {
  receivedAggregationsFromGrants,
  sharedBuildingsFromGrants,
  sharedAggregationsFromGrants,
  sharedWithMeFromGrants,
} from "../services/interop/sharing.ts";
import { readPrefs } from "../services/prefs.ts";
import {
  getComputedSnapshotByAggregationId,
  getReceivedBenchmarksFor,
  getAggregationDefinition,
  getAggregationDefinitions,
  loadComputedSnapshot,
} from "../services/aggregation/aggregation.ts";
import {
  loadSharedBuilding,
  type SharedBuildingEntry,
} from "../services/interop/sharedBuilding.ts";
import { refreshSnapshot } from "../services/aggregation/aggregationComputer.ts";
import {
  getRoomLogState,
  readRoomNames,
  readRooms,
} from "../services/interop/dataRoom.ts";
import { readAgents } from "../services/savedAgents.ts";
import {
  resolveAgent,
  resolveAgentOrg,
} from "../services/agents/agentResolver.ts";
import {
  type EnergyDatasetRef,
  type EnergyMetricKey,
  listSeriesDays,
} from "../services/energy/energyDataset.ts";
import { fetchEnergyDatasetsShared } from "../services/energy/energyDatasetCache.ts";
import { parseTtlReadings } from "../services/rdf/userEnergyParser.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import type {
  EnergyByBuildingYear,
  EnergyByYear,
} from "../services/energy/energyTimeCut.ts";
import { fetchFresh } from "../services/pod/podFetch.ts";
import { emitNotification } from "../lib/notificationSink.ts";
import type {
  AggregationDefinition,
  AggregationSnapshot,
  AnnualData,
  Building,
  Energy,
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
 * The shape every session-scoped read shares: a query keyed `[...prefix, webId,
 * ...extra]`, gated on a resolved WebID, fed the authed `getSession()` transport.
 * Folding it into one helper makes the **WebID namespacing structural** — a new
 * read can't forget to put the WebID in its key (the contract a re-login relies
 * on) — and collapses ~15 hooks to one line each. `opts.enabled` is ANDed with
 * `Boolean(webId)`; `opts.extraKey` appends content/identity fingerprints after
 * the WebID; `opts.staleTime` is passed through only when set (so the default
 * `staleTime: 0` from QueryProvider still governs unless a hook opts out).
 *
 * Not for reads keyed on some OTHER agent's WebID (`useResolveAgent`/`Org`, which
 * key on the *target*, not the session) — those stay bespoke by design.
 */
function useWebIdQuery<T>(
  keyPrefix: readonly unknown[],
  queryFn: (gateway: PodGateway, webId: string) => Promise<T>,
  opts: {
    extraKey?: readonly unknown[];
    enabled?: boolean;
    staleTime?: number;
  } = {},
) {
  const webId = webIdOf();
  // exhaustive-deps can't see through this generic wrapper: `queryFn` is INJECTED
  // by each caller, which is also responsible for fingerprinting its inputs into
  // the key via `opts.extraKey` (e.g. energyKeyFor). The rule still guards every
  // direct useQuery site (useResolveAgent/Org, the weather hooks).
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: [...keyPrefix, webId, ...(opts.extraKey ?? [])],
    enabled: Boolean(webId) && (opts.enabled ?? true),
    queryFn: () => queryFn(getGateway(), webId as string),
    ...(opts.staleTime !== undefined ? { staleTime: opts.staleTime } : {}),
  });
}

/**
 * The shape every "shared-with/by-me" list shares: a pure in-memory derivation of
 * one folded log query (never a second fold), passing the log's loading/error
 * flags straight through. Keeps the fold-once discipline and the uniform
 * `{ data, isLoading, isFetching, error }` result. (`useSharedWithMe` folds TWO
 * upstreams — log + prefs — so it stays explicit.)
 */
function useDeriveFromQuery<TData, TOut>(
  query: {
    data: TData | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
  },
  selector: (data: TData) => TOut,
): {
  data: TOut | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
} {
  const { data: raw } = query;
  const data = useMemo(
    () => (raw !== undefined ? selector(raw) : undefined),
    [raw, selector],
  );
  return {
    data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

/** Combine selector for a sharing log's per-event queries: fold to the active grants,
 * plus the aggregate load/error state. Module-level (stable identity) so `useQueries`
 * memoises it. */
function foldEventQueries(results: Array<UseQueryResult<SharingEvent[]>>) {
  return {
    grants: grantsFromEvents(foldEvents(results.flatMap((r) => r.data ?? []))),
    anyData: results.some((r) => r.data !== undefined),
    isLoading: results.some((r) => r.isLoading),
    isFetching: results.some((r) => r.isFetching),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/**
 * One append-only sharing log as a container listing query (`sharedInContainer`/`sharedOutContainer`
 * — what mutations invalidate) + one `["sharingEvent", …]` query per event. Events are
 * IMMUTABLE (server-minted IRIs), so each per-event query is `staleTime: Infinity`:
 * invalidating the container re-lists and refolds while existing events stay warm, so a
 * new share fetches only the new event. The fold is a `combine` selector (derive-at-edge),
 * and the uniform `{ data, isLoading, isFetching, error, isError }` result feeds the
 * `*FromGrants` derivations + `useBuildings`.
 */
function useSharingLog(
  containerKey: readonly unknown[],
  containerUriFor: (webId: string) => string,
): {
  data: ActiveGrant[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  isError: boolean;
} {
  const webId = webIdOf();
  const container = useWebIdQuery(
    containerKey,
    (gateway, wid) => listLogEvents(containerUriFor(wid), gateway),
  );
  const eventUris = container.data;
  const events = useQueries({
    queries: (eventUris ?? []).map((uri) => ({
      queryKey: [...queryKeys.sharingEvent, webId, uri],
      queryFn: () => loadSharingEvent(uri, getGateway()),
      enabled: Boolean(webId),
      staleTime: Infinity,
    })),
    combine: foldEventQueries,
  });
  const error = container.error ?? events.error ?? null;
  const ready = container.data !== undefined; // listing resolved
  const stillInitial = ready && !events.anyData && events.isLoading;
  return {
    data: (ready && !stillInitial) ? events.grants : undefined,
    isLoading: (container.isLoading || stillInitial) && error == null,
    isFetching: container.isFetching || events.isFetching,
    error,
    isError: error != null,
  };
}

/**
 * The folded `shared-in/` log — THE one fold per load. Everything "shared with me"
 * (shared building sources, the Share-tab list, received aggregations, received
 * benchmarks) derives from this hook's grants instead of folding the log again; the
 * container is listed once (deduped) and each event is read once across consumers.
 */
export function useSharedInGrants() {
  return useSharingLog(queryKeys.sharedInContainer, sharedInUri);
}

/** The folded `shared-out/` log — see {@link useSharedInGrants}; the
 * shared-buildings and shared-aggregations lists derive from it. */
export function useSharedOutGrants() {
  return useSharingLog(queryKeys.sharedOutContainer, sharedOutUri);
}

/** `prefs.ttl` (hidden buildings, …). Invalidated by the visibility toggle. */
export function usePrefs() {
  return useWebIdQuery(queryKeys.prefs, (session) => readPrefs(session));
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
/**
 * The own-buildings container listing — the membership query (`ldp:contains` → top-level
 * `*.ttl` IRIs). It does NOT depend on the shared-in fold (shared sources come from there
 * separately); adding/deleting a building invalidates it. Resolves the storage root first,
 * like the old buildings query. A fresh Pod (404 container) reads as `[]`, not an error.
 */
export function useBuildingsContainer() {
  return useWebIdQuery(
    queryKeys.buildingsContainer,
    async (gateway, webId) => {
      await resolveStorageRoot(gateway);
      return listOwnBuildings(gateway, webId);
    },
  );
}

/**
 * Reconciliation for the per-source building reads — the WRITES the pure selector
 * can't do. A SHARED source that 403/404'd means access was revoked: append a
 * self-revocation to shared-in/ (once per uri) and refold the log so the source drops
 * out. A transient failure (not 401/403/404) can't self-heal — notify once so the
 * missing building isn't a silent gap. An OWN-source 403/404 is a real problem, not a
 * revocation, so it's left alone. The ref-guards make each prune/notice fire at most
 * once per uri per session (an append-log would otherwise spam).
 */
function useReconcileBuildingSources(
  failures: ReadonlyArray<{ uri: string; status?: number; isOwn: boolean }>,
  qc: QueryClient,
) {
  const pruned = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toPrune = failures.filter(
      (f) =>
        !f.isOwn && (f.status === 403 || f.status === 404) &&
        !pruned.current.has(f.uri),
    );
    if (toPrune.length > 0) {
      for (const f of toPrune) pruned.current.add(f.uri);
      removeInaccessibleBuildingSources(
        toPrune.map((f) => ({ uri: f.uri, status: f.status! })),
        getGateway(),
      )
        .then(() => qc.invalidateQueries({ queryKey: queryKeys.sharedInContainer }))
        .catch((e) => logError("prune inaccessible building source", e));
    }
    const transient = failures.filter(
      (f) =>
        f.status !== 401 && f.status !== 403 && f.status !== 404 &&
        !notified.current.has(f.uri),
    );
    if (transient.length > 0) {
      for (const f of transient) notified.current.add(f.uri);
      const n = transient.length;
      emitNotification(
        `Couldn't load ${n} building${n === 1 ? "" : "s"} — the Pod was slow ` +
          `to respond. Reload the page to try again.`,
        "warning",
      );
    }
  }, [failures, qc]);
}

export function useBuildings() {
  const qc = useQueryClient();
  const webId = webIdOf();
  const container = useBuildingsContainer();
  const log = useSharedInGrants();
  const prefs = usePrefs();

  // Each dependency degrades to "empty" on error rather than blocking own buildings.
  // `ready` gates on own + shared sources being KNOWN; hidden is NOT a gate (it's a
  // selector concern, so a visibility toggle re-derives without any refetch).
  const ownSources = container.data ?? (container.isError ? [] : undefined);
  const sharedSources = log.data
    ? sharedBuildingSourcesFromGrants(log.data)
    : log.isError
    ? []
    : undefined;
  const ready = ownSources !== undefined && sharedSources !== undefined;
  const hidden = useMemo(
    () =>
      prefs.data
        ? prefs.data.hiddenBuildings
        : prefs.isError
        ? new Set<string>()
        : undefined,
    [prefs.data, prefs.isError],
  );

  const ownFp = (ownSources ?? []).join(";");
  const sharedFp = (sharedSources ?? []).join(";");
  const sources = useMemo(
    (): Array<{ uri: string; isOwn: boolean }> => {
      if (!ready) return [];
      const seen = new Map<string, boolean>();
      for (const u of ownSources!) if (!seen.has(u)) seen.set(u, true);
      for (const u of sharedSources!) if (!seen.has(u)) seen.set(u, false);
      return [...seen].map(([uri, isOwn]) => ({ uri, isOwn }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, ownFp, sharedFp],
  );

  // Pure: collect buildings (hidden-filtered, isShared set) + the per-source failures;
  // select the surfaced error (only when ALL sources failed; 401 → SessionExpired).
  // Never writes — the writes live in `useReconcileBuildingSources`.
  const combine = useCallback(
    (results: Array<UseQueryResult<Building[]>>) => {
      const buildings: Building[] = [];
      const failures: Array<{ uri: string; status?: number; isOwn: boolean }> = [];
      sources.forEach((s, i) => {
        const r = results[i];
        for (const b of r?.data ?? []) {
          // `isShared` is set at parse time (per source); here we only drop hidden.
          if (hidden?.has(buildingFileUri(b.uri))) continue;
          buildings.push(b);
        }
        if (r?.error) {
          const status = r.error instanceof BuildingSourceError
            ? r.error.status
            : undefined;
          failures.push({ uri: s.uri, status, isOwn: s.isOwn });
        }
      });
      const allFailed = results.length > 0 && results.every((r) => r.isError);
      const error: Error | null = allFailed
        ? (failures.some((f) => f.status === 401)
          ? new SessionExpiredError()
          : (results.find((r) => r.error)?.error ?? null))
        : null;
      return {
        buildings,
        failures,
        error,
        anyData: results.some((r) => r.data !== undefined),
        isLoading: results.some((r) => r.isLoading),
        isFetching: results.some((r) => r.isFetching),
      };
    },
    [sources, hidden],
  );

  const q = useQueries({
    queries: sources.map((s) => ({
      queryKey: [...queryKeys.buildingSource, webId, s.uri],
      queryFn: () => loadBuildingSource(s.uri, getGateway(), getStorageRoot(webId!)),
      enabled: ready && Boolean(webId),
      staleTime: Infinity,
    })),
    combine,
  });

  useReconcileBuildingSources(q.failures, qc);

  // `data === undefined` through the whole gated + first-load window (so
  // `useSolidData().isLoading` stays true and the empty state doesn't flash), but
  // adding a source later keeps the existing list on screen (anyData), not a blank.
  const stillInitial = !q.anyData && q.isLoading;
  const data = (!ready || stillInitial) ? undefined : { buildings: q.buildings };
  return {
    data,
    isLoading: !ready || stillInitial,
    isFetching: !ready || q.isFetching,
    error: q.error,
  };
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
 * changes — e.g. the demo seed adding buildings.) `useBuildinglessObservations` still
 * keys on it; `useEnergy` and `useAnnualEnergyByYear` now fan out per-building
 * (`buildingEnergyKeyFor`). */
/**
 * The energy query's content fingerprint: each building's id PLUS its
 * `cons:hasEnergyDataset` links (year/granularity/scenario), so the key changes
 * whenever a dataset link is added/removed — not only when the building set does.
 * Exported (and pure) so the coverage is unit-testable.
 */
export function energyKeyFor(buildings: Building[] | undefined): string {
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

/**
 * Each building's energy as its OWN per-building query
 * (`["buildingEnergy", webId, uri, <link-fingerprint>]`), recomposed into the screen
 * shapes — the `energyNeed` array and the portfolio/operator averages — by a `combine`
 * selector (derive-at-edge). This retires the whole-set `energyKeyFor` fold for the map
 * energy: one building's energy edit refetches only that building's query, mostly served
 * warm from the shared per-dataset cache (`fetchEnergyDatasetShared`). The sole caller is
 * `useSolidData`. See `plans/plan-ldp-query-layer.md`.
 */
export function useEnergy(buildings: Building[] | undefined) {
  const webId = webIdOf();
  return useQueries({
    queries: (buildings ?? []).map((b) => ({
      queryKey: [...queryKeys.buildingEnergy, webId, b.uri, buildingEnergyKeyFor(b)],
      queryFn: () => resolveBuildingEnergy(b, getGateway()),
      enabled: Boolean(webId),
    })),
    combine: (results) => {
      const entries = (buildings ?? [])
        .map((b, i) => ({ building: b, energy: results[i]?.data ?? null }))
        .filter(
          (e): e is { building: Building; energy: Energy } => e.energy !== null,
        );
      return {
        energyNeed: entries.map((e) => e.energy),
        ...computeEnergyAverages(entries),
        error: results.find((r) => r.error)?.error ?? null,
      };
    },
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
  return useDeriveFromQuery(useSharedOutGrants(), sharedBuildingsFromGrants);
}

export function useAggregationDefinitions() {
  return useWebIdQuery(
    queryKeys.aggregationDefinitions,
    (session) => getAggregationDefinitions(session),
  );
}

export interface AggregationDetail {
  definition: AggregationDefinition | null;
  snapshot: AggregationSnapshot | null;
  /** Set when the snapshot auto-materialise failed; the page surfaces it inline. */
  computeError?: unknown;
}

/**
 * One aggregation's standalone-page data (/aggregation/:id): definition + computed snapshot,
 * keyed by aggregation id. A definition without a snapshot — a freshly created aggregation —
 * is auto-materialised here so the chart renders immediately instead of an
 * empty "Refresh Snapshot" prompt: a reconciliation write inside a read path
 * (a documented seam — notes/queries-mutations.md §Seams). Best-effort: a
 * failed compute travels in `computeError` and the read still succeeds with
 * the definition (Refresh is the retry affordance). Safe to key the write on a
 * null snapshot: loadComputedSnapshot returns null ONLY for genuine absence
 * (404) and THROWS on transient failures, so a failed read of an EXISTING
 * snapshot can never trigger it. Invalidated by the refresh-aggregation and
 * delete-aggregation mutations.
 */
export function useAggregationDetail(aggregationId: string | undefined) {
  return useWebIdQuery(
    queryKeys.aggregationDetail,
    async (session): Promise<AggregationDetail> => {
      const id = aggregationId as string;
      const [definition, snapshot] = await Promise.all([
        getAggregationDefinition(session, id),
        getComputedSnapshotByAggregationId(session, id),
      ]);
      if (!definition || snapshot) return { definition, snapshot };
      try {
        const { snapshot: computed } = await refreshSnapshot(session, id);
        // Re-read the definition so lastComputedAt reflects the compute.
        const updated = await getAggregationDefinition(session, id);
        return { definition: updated ?? definition, snapshot: computed };
      } catch (computeError) {
        return { definition, snapshot: null, computeError };
      }
    },
    { extraKey: [aggregationId], enabled: Boolean(aggregationId) },
  );
}

/** Aggregations the user has shared with others, from shared-out grants. */
export function useSharedAggregations() {
  return useDeriveFromQuery(useSharedOutGrants(), sharedAggregationsFromGrants);
}

/** Aggregations shared *with* the current user, from shared-in grants. */
export function useReceivedAggregations() {
  return useDeriveFromQuery(useSharedInGrants(), receivedAggregationsFromGrants);
}

/**
 * A received aggregation's computed snapshot, loaded by IRI (the recipient holds Read on
 * the snapshot, not the definition). Render-driven — a row mounts and needs the
 * snapshot to show its name + values — so it's a query, not a hand-rolled effect.
 * `null` data means a genuinely absent/empty snapshot (404); a transient failure
 * surfaces as `error`.
 */
export function useComputedSnapshot(snapshotUri: string | undefined) {
  return useWebIdQuery(
    queryKeys.computedSnapshot,
    (session) => loadComputedSnapshot(session, snapshotUri as string),
    { extraKey: [snapshotUri], enabled: Boolean(snapshotUri) },
  );
}

/**
 * One building shared *with* the user, loaded in full by IRI (its attachments
 * aren't in the lightweight shared-list entry). Render-driven (the shared-files
 * preview mounts and needs it), so a query rather than an effect.
 */
export function useSharedBuildingDetail(entry: SharedBuildingEntry | undefined) {
  return useWebIdQuery(
    queryKeys.sharedBuildingDetail,
    (session) => loadSharedBuilding(entry as SharedBuildingEntry, session),
    { extraKey: [entry?.buildingUri], enabled: Boolean(entry) },
  );
}

/**
 * The benchmark snapshots received from a BSP (the subset of received aggregations
 * marked as a benchmark result). The energy aggregation compares the owner's own
 * figures against these. Loads each received snapshot, so it stays a real
 * query — but DEPENDENT on the folded shared-in log (no second fold), keyed
 * on the received-snapshot URLs so a grant arriving/leaving refetches because
 * the data changed. The plain `receivedBenchmarks` prefix invalidation (inbox
 * drain) still matches — snapshot CONTENTS can change with the grant set
 * unchanged.
 */
export function useReceivedBenchmarks() {
  const log = useSharedInGrants();
  const received = useMemo(
    () => (log.data ? receivedAggregationsFromGrants(log.data) : undefined),
    [log.data],
  );
  const fingerprint = (received ?? []).map((r) => r.snapshotUri).sort().join(";");
  return useWebIdQuery(
    queryKeys.receivedBenchmarks,
    (session) => getReceivedBenchmarksFor(session, received ?? []),
    { extraKey: [fingerprint], enabled: received !== undefined },
  );
}

/**
 * Data-room registry — `current` + `known`. Owned by the room mutations, which
 * `setQueryData` it authoritatively (see mutations.ts): it is fetched once on
 * load and thereafter never refetched, so a slow/stale read-back can't revert a
 * switch. (Diagnosed: solidcommunity.net/Cloudflare can serve a stale
 * conditional read right after the write — see project memory.)
 */
export function useRooms() {
  // The room registry is managed optimistically (mutations patch the cache);
  // unlike the rest of the app's staleTime:0 + conditional-GET freshness, it
  // must NOT auto-refetch — a background refetch could revert an in-flight
  // optimistic room switch. Encode that invariant (staleTime: Infinity) rather
  // than relying on the absence of an invalidation.
  return useWebIdQuery(queryKeys.rooms, (session) => readRooms(session), {
    staleTime: Infinity,
  });
}

/**
 * The human names (`rdfs:label`) of the given rooms, keyed by room URI — read from
 * each room's member-readable name resource so the finder can show a name instead
 * of the raw IRI. Keyed by the URI set, so hosting/adding a room (which changes the
 * set) refetches; names are otherwise stable (`staleTime: Infinity`). An empty list
 * does no fetch.
 */
export function useRoomNames(roomUris: readonly string[]) {
  return useWebIdQuery(
    queryKeys.rooms,
    (gateway) => readRoomNames(roomUris, gateway),
    { extraKey: ["names", ...[...roomUris].sort()], staleTime: Infinity },
  );
}

/** Members / my-roles / my-membership for one room, keyed on the current room. */
function useRoomLog(current: string | null) {
  return useWebIdQuery(
    queryKeys.roomLog,
    (session) => getRoomLogState(session, current as string),
    { extraKey: [current], enabled: Boolean(current) },
  );
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
function freshFetchFn(): (uri: string) => Promise<Response> {
  const gateway = getGateway();
  return (uri) => fetchFresh(uri, gateway);
}

/**
 * One building's annual (non-series) energy datasets, split by scenario and
 * sorted by year — what the detail pane's annual view renders. Keyed on the
 * dataset-link fingerprint (`energyKeyFor`), so saving/deleting an energy year
 * refetches because the *data* changed, not because the view remembered to;
 * content-only edits (same links) are covered by the energy mutations' explicit
 * `invalidateBuildingData` invalidation.
 */
export function useAnnualEnergy(building: Building) {
  return useWebIdQuery(
    queryKeys.annualEnergy,
    async () => {
      const refs = (building.energyDatasets ?? []).filter(
        // Building-level annual only — per-unit (featureOfInterest) series are shown
        // under their unit, not in the building's annual chart.
        (r) => !isSeriesGranularity(r.granularity) && !r.featureOfInterest,
      );
      const datasets = await fetchEnergyDatasetsShared(refs, getGateway());
      const rows = (scenario: "actual" | "planned") =>
        datasets
          .filter((d) => d.scenario === scenario && d.metrics)
          .map((d) => ({ year: d.year, ...d.metrics }) as AnnualData)
          .sort((a, b) => a.year - b.year);
      // The building's ORIGINAL (non-canonical) unit per metric, when it has one — the
      // numeric rows stay canonical (kWh/m³/%); this drives the per-building display +
      // export to show e.g. MWh. Last dataset wins (a building's metric is one unit).
      const units: Partial<Record<EnergyMetricKey, string>> = {};
      for (const d of datasets) {
        for (const [k, u] of Object.entries(d.units ?? {})) {
          units[k as EnergyMetricKey] = u;
        }
      }
      return { actual: rows("actual"), planned: rows("planned"), units };
    },
    { extraKey: [building.id, energyKeyFor([building])] },
  );
}

/**
 * One building's stored annual (P1Y) energy datasets as the raw
 * `EnergyDataset[]` (year/scenario/metrics) — what the energy-year dialog lists
 * and edits back. Keyed on the building's dataset-link fingerprint so adding or
 * removing a year refetches once the building prop updates; the dialog also
 * patches this cache optimistically on save/delete for instant read-back, so it
 * is deliberately NOT in `invalidateBuildingData` (an immediate post-write
 * refetch with the still-stale building prop would clobber the optimistic row).
 * `enabled` gates it to the open dialog.
 */
export function useAnnualDatasets(
  building: Building | null,
  enabled = true,
) {
  return useWebIdQuery(
    queryKeys.annualDatasets,
    () => {
      const refs = (building?.energyDatasets ?? []).filter(
        (r) => r.granularity === "P1Y",
      );
      return fetchEnergyDatasetsShared(refs, getGateway());
    },
    {
      extraKey: [building?.id ?? "", building ? energyKeyFor([building]) : ""],
      enabled: enabled && building != null,
    },
  );
}

/**
 * The user's **building-less** observations — unbound annual datasets in their own
 * `observations/` that no building links. Discovered by listing the container and
 * subtracting the building-linked datasets (so a newly-bound observation drops out:
 * the `energyKeyFor` fingerprint re-runs this when a building's links change). Own-Pod
 * only; gated on the buildings being loaded (needed to compute the bound set).
 */
export function useBuildinglessObservations(
  buildings: Building[] | undefined,
  enabled = true,
) {
  return useWebIdQuery(
    queryKeys.buildinglessObservations,
    (gateway, webId) => {
      const bound = new Set(
        (buildings ?? []).flatMap((b) =>
          (b.energyDatasets ?? []).map((d) => d.uri.split("#")[0])
        ),
      );
      return loadBuildinglessObservations(gateway, webId, bound);
    },
    {
      extraKey: [energyKeyFor(buildings)],
      enabled: enabled && buildings != null,
    },
  );
}

/**
 * Every reachable annual energy figure across the building set, keyed by building
 * id and the year it covers — the per-year cube the map's interactive time-cut
 * slider (`plans/plan-cube-ui.md` §1) re-colours over. `useEnergy` keeps only each
 * building's LATEST year (enough to paint the static map); the slider scrubs the whole
 * range, so this loads ALL actual annual datasets. Like `useEnergy`, it's a `useQueries`
 * fan-out (one query per building, `["buildingEnergyByYear", …]`) combined into the cube,
 * so the whole-set `energyKeyFor` is retired here too; `enabled` gates it to the energy
 * lens so the extra GETs only happen when the lens (and thus the slider) is in use. The
 * returned `{ data, isFetching, isLoading, error }` mirrors the query-result shape its
 * consumers read.
 */
export function useAnnualEnergyByYear(
  buildings: Building[] | undefined,
  enabled = true,
) {
  const webId = webIdOf();
  // Stable so useQueries memoises the combined value — its consumers put `data`
  // (the cube Map) in `useMemo`/`useEffect` deps, which would churn every render
  // if the combined result got a fresh identity.
  const combine = useCallback(
    (results: { data?: EnergyByYear; isFetching: boolean; isLoading: boolean; error: Error | null }[]) => {
      const data: EnergyByBuildingYear = new Map();
      (buildings ?? []).forEach((b, i) => {
        const byYear = results[i]?.data;
        if (byYear && byYear.size > 0) data.set(b.id, byYear);
      });
      return {
        data,
        isFetching: results.some((r) => r.isFetching),
        isLoading: results.some((r) => r.isLoading),
        error: results.find((r) => r.error)?.error ?? null,
      };
    },
    [buildings],
  );
  return useQueries({
    queries: (buildings ?? []).map((b) => ({
      queryKey: [...queryKeys.buildingEnergyByYear, webId, b.uri, buildingEnergyKeyFor(b)],
      queryFn: () => resolveBuildingEnergyByYear(b, getGateway()),
      enabled: Boolean(webId) && enabled,
    })),
    combine,
  });
}

/**
 * Whether to offer the fresh-Pod demo buildings: true when the user's OWN
 * buildings container is absent or empty AND the demo hasn't been declined
 * (`prefs.demoSeedDeclined`). A render-driven probe (lists the container + reads
 * prefs) rather than a hand-rolled effect; the dashboard layers a session-local
 * "dismissed" flag over it so seeding/declining hides the banner instantly. Read
 * once per load (no invalidation): the dismissal covers the in-session hide, a
 * reload re-probes.
 */
export function useDemoOffer() {
  return useWebIdQuery(
    queryKeys.demoOffer,
    async (session, webId) => {
      const [children, prefs] = await Promise.all([
        listDirectChildren(podResources(webId).buildings, session),
        readPrefs(session),
      ]);
      const empty = children === null || children.length === 0;
      return empty && !prefs.demoSeedDeclined;
    },
  );
}

/**
 * The day files behind a set of 15-minute series descriptors (one listing per
 * ref, concurrent), merged and sorted by day. Feeds the user-energy chart's
 * date/month pickers and the create-aggregation dialog's month list (months are a
 * cheap `day.substring(0, 7)` derivation at the call site).
 */
export function useSeriesDays(refs: EnergyDatasetRef[]) {
  const refKey = refs.map((r) => r.uri).sort().join(";");
  return useWebIdQuery(
    queryKeys.seriesDays,
    async (session) => {
      const perRef = await Promise.all(
        refs.map((ref) => listSeriesDays(session, ref)),
      );
      return perRef.flat().sort((a, b) => a.day.localeCompare(b.day));
    },
    { extraKey: [refKey], enabled: refs.length > 0 },
  );
}

/** One day file's 15-minute readings; disabled until a date is picked. */
export function useDayReadings(uri: string | undefined) {
  return useWebIdQuery(
    queryKeys.dayReadings,
    () => parseTtlReadings(uri as string, freshFetchFn()),
    { extraKey: [uri], enabled: Boolean(uri) },
  );
}

/**
 * A month of day files at once, as `Map<day, readings>` — unreadable days are
 * skipped (`allSettled`), matching the chart's previous tolerance. `enabled`
 * gates it to the monthly tabs so the bulk fetch never runs for the day view.
 */
export function useMonthReadings(
  entries: { day: string; uri: string }[],
  enabled: boolean,
) {
  const entryKey = entries.map((e) => e.uri).join(";");
  return useWebIdQuery(
    queryKeys.monthReadings,
    async () => {
      const fetchFn = freshFetchFn();
      const result = new Map<string, Array<{ begin: string; value: number }>>();
      const settled = await Promise.allSettled(
        entries.map((e) =>
          parseTtlReadings(e.uri, fetchFn).then((data) => ({
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
    { extraKey: [entryKey], enabled: enabled && entries.length > 0 },
  );
}

/** The personal contacts address book (folds agents.ttl). */
export function useAgents() {
  return useWebIdQuery(queryKeys.agents, (session) => readAgents(session));
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
    queryFn: () => resolveAgent(webId as string, getGateway()),
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
    queryFn: () => resolveAgentOrg(webId as string, getGateway()),
  });
}

/**
 * Query-key prefixes — the single source for the hooks above AND the mutation
 * invalidations (mutations.ts), so the invalidation contract can't drift on a
 * key typo.
 */
export const queryKeys = {
  // ─── Container listings & per-resource reads (the resource-query layer) ───
  /** The own-buildings container listing (`["buildingsContainer", webId]`) — the
   * membership query the `useBuildings` fan-out reads its own source IRIs from. */
  buildingsContainer: ["buildingsContainer"] as const,
  /** One building source document (`["buildingSource", webId, sourceUri]` → `Building[]`)
   * — the per-resource read the `useBuildings` fan-out and `fetchBuildingSourceShared`
   * go through. */
  buildingSource: ["buildingSource"] as const,
  /** One energy dataset, keyed by its node IRI (`["energyDataset", webId, uri]`) — the
   * shared per-resource read the map fold and the aggregation compute both go through. */
  energyDataset: ["energyDataset"] as const,
  /** The `shared-in/` log's container LISTING (event IRIs) — everything "shared with me"
   * derives from folding it; mutations invalidate this to re-list + refold. */
  sharedInContainer: ["sharedInContainer"] as const,
  /** The `shared-out/` log's container listing — the shared-buildings/-aggregations lists
   * derive from folding it. */
  sharedOutContainer: ["sharedOutContainer"] as const,
  /** One sharing-log event (`["sharingEvent", webId, eventUri]` → `SharingEvent[]`) — the
   * immutable per-event read the log fan-outs cache (staleTime Infinity). */
  sharingEvent: ["sharingEvent"] as const,

  // ─── Per-building energy (fan-out selectors + detail/series reads) ───
  /** One building's latest-annual energy, keyed per building
   * (`["buildingEnergy", webId, buildingUri, linkFingerprint]`) — the `useEnergy`
   * useQueries fan-out; the portfolio/operator averages derive from these in `combine`. */
  buildingEnergy: ["buildingEnergy"] as const,
  /** One building's per-year annual cube (`["buildingEnergyByYear", webId, uri, fingerprint]`)
   * — the `useAnnualEnergyByYear` useQueries fan-out behind the time-cut slider. */
  buildingEnergyByYear: ["buildingEnergyByYear"] as const,
  /** One building's annual datasets (detail pane), keyed by id + link fingerprint. */
  annualEnergy: ["annualEnergy"] as const,
  /** One building's raw annual datasets (energy-year dialog), keyed by id + fingerprint. */
  annualDatasets: ["annualDatasets"] as const,
  /** The user's building-less (unbound) observations, keyed by the building-link fingerprint. */
  buildinglessObservations: ["buildinglessObservations"] as const,
  /** Day files behind a set of 15-min series descriptors, keyed by ref URLs. */
  seriesDays: ["seriesDays"] as const,
  /** One day file's readings, keyed by URL. */
  dayReadings: ["dayReadings"] as const,
  /** A month of day files (bulk), keyed by the entry URLs. */
  monthReadings: ["monthReadings"] as const,

  // ─── Aggregations & received shares ───
  aggregationDefinitions: ["aggregationDefinitions"] as const,
  /** One aggregation's definition + computed snapshot (the standalone /aggregation page), keyed by aggregation id. */
  aggregationDetail: ["aggregationDetail"] as const,
  /** A received aggregation's computed snapshot, keyed by snapshot IRI. */
  computedSnapshot: ["computedSnapshot"] as const,
  /** A building shared with the user, loaded in full, keyed by building IRI. */
  sharedBuildingDetail: ["sharedBuildingDetail"] as const,
  /** Benchmark snapshots received from a BSP (subset of received aggregations). */
  receivedBenchmarks: ["receivedBenchmarks"] as const,

  // ─── Rooms & agents ───
  /** The room registry (current + known). Set via setQueryData, not invalidated. */
  rooms: ["rooms"] as const,
  /** A room's log (members + roles), keyed by room. Invalidated on role saves. */
  roomLog: ["roomLog"] as const,
  /** The saved-agents address book. Invalidated on save/remove. */
  agents: ["savedAgents"] as const,
  /** A single resolved agent (name/avatar), keyed by WebID. */
  agent: ["agent"] as const,
  /** A single resolved agent's organisation (name + logo IRI), keyed by WebID. */
  agentOrg: ["agentOrg"] as const,

  // ─── App state ───
  /** prefs.ttl (hidden buildings, …). Invalidated by the visibility toggle. */
  prefs: ["prefs"] as const,
  /** The fresh-Pod demo-buildings offer (own container empty + not declined). */
  demoOffer: ["demoOffer"] as const,
};

/**
 * The composed buildings + energy view: `useSolidData` folds `useBuildings` and
 * `useEnergy` into one shape for the surfaces that need both. Surfaces needing only
 * one can call the granular hooks above directly.
 */
export interface SolidData {
  buildings: Building[];
  energyNeed: Energy[];
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
    energyNeed: energy.energyNeed,
    portfolioAverages: energy.portfolioAverages,
    operatorAverages: energy.operatorAverages,
    // True for the whole initial window — including while `useBuildings` is still
    // GATED on its shared-in/prefs dependencies (a disabled query reports
    // `isLoading: false`, which would otherwise flash the empty state before the
    // fetch even starts). Once buildings resolve, `ba.data` is defined even for an
    // empty Pod, so a genuinely-empty account reads as loaded, not loading.
    isLoading: !err && ba.data === undefined,
    error: err ? (err instanceof Error ? err.message : String(err)) : null,
  };
}
