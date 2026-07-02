import { DataFactory, Parser } from "n3";
import type { Quad } from "@rdfjs/types";
import type { Building } from "../../types.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { queryKeys } from "../../lib/queryKeys.ts";
import { fetchFresh } from "../pod/podFetch.ts";
import { parseBuildings } from "../rdf/building/buildingParser.ts";
import { buildingFileUri } from "../rdf/building/buildingId.ts";
import { recordGraph } from "../rdf/rdfDataset.ts";

/**
 * One building source file as a per-resource read — the buildings analogue of the
 * energy dataset cache (`services/energy/energyDatasetCache.ts`). A source is one
 * `.ttl` document; because the parser is type-driven (`rdf:type rec:Building`), a
 * foreign document can carry several buildings, so the value is `Building[]`. Both
 * `useBuildings` (reactive) and the headless `loadBuildings` fold read through this,
 * so the per-source shape can't drift. See `plans/plan-ldp-query-layer.md`.
 */

/** An unreadable building source — carries the HTTP status for the caller to classify
 * (403/404 = access revoked, prunable; 401 = token; else transient). */
export class BuildingSourceError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BuildingSourceError";
    this.status = status;
  }
}

/**
 * Parse ONE building source document into its `Building[]`. The quad graph is set to
 * the source IRI so the parser records `building.sourceUri` (the ownership check).
 * Unlike the old aggregate parse, each source parses into its own n3 Store, so blank
 * nodes can't collide across sources — no bnode scoping is needed. `isShared` is set
 * here (a deterministic function of the source IRI vs the owner's storage root, uniform
 * for every building in the source); the hidden filter stays a downstream concern.
 */
export function parseBuildingSource(
  ttl: string,
  sourceUri: string,
  storageRoot?: string,
): Building[] {
  const graph = DataFactory.namedNode(sourceUri);
  const quads: Quad[] = new Parser({ baseIRI: sourceUri })
    .parse(ttl)
    .map((q) => DataFactory.quad(q.subject, q.predicate, q.object, graph));
  // Every parse feeds the RDF dataset (named graph = document IRI), so the
  // provenance inspector can answer per-subject lookups from the same quads the
  // object projection consumed.
  recordGraph(sourceUri, quads);
  const buildings = [...parseBuildings(quads, storageRoot).values()];
  if (storageRoot !== undefined) {
    const isShared = isSharedSource(sourceUri, storageRoot);
    for (const b of buildings) b.isShared = isShared;
  }
  return buildings;
}

/**
 * Ownership, derived from WHERE the source document lives: a source outside the
 * viewer's storage root is shared-with-me; under it, their own. The ONE
 * predicate every ownership derivation goes through (this per-source parse, the
 * headless {@link import("../../intents/entityQuery.ts").resolveEntity}
 * resolver), so the app load path and the resolvers cannot disagree about which
 * buildings are own — the distinction that gates every owner-only verb. With no
 * resolved root, ownership cannot be claimed → shared (the conservative default
 * for owner-only affordance guards).
 */
export function isSharedSource(
  sourceUri: string,
  storageRoot: string | undefined,
): boolean {
  return storageRoot ? !sourceUri.startsWith(storageRoot) : true;
}

/**
 * Fetch + parse one building source. Throws {@link BuildingSourceError} (with the HTTP
 * status) when the document is unreadable, so the caller can classify revoked-grant
 * (403/404), token (401) and transient failures. `fetchFresh` revalidates (304s).
 */
export async function loadBuildingSource(
  sourceUri: string,
  gateway: PodGateway,
  storageRoot?: string,
): Promise<Building[]> {
  const res = await fetchFresh(sourceUri, gateway);
  if (!res.ok) {
    throw new BuildingSourceError(
      `HTTP ${res.status}: ${res.statusText} for ${sourceUri}`,
      res.status,
    );
  }
  return parseBuildingSource(await res.text(), sourceUri, storageRoot);
}

/**
 * The React Query key for one building source, keyed by its document IRI — namespaced
 * by WebID like the other keys. `invalidateBuildingData` (`hooks/mutations.ts`)
 * invalidates the `["buildingSource"]` prefix.
 */
export function buildingSourceKey(webId: string, sourceUri: string) {
  return [...queryKeys.buildingSource, webId, sourceUri] as const;
}

/**
 * One building source's `Building[]`, read **once** across consumers through the warm
 * query cache when the app is mounted (`ensureQueryData`), else a direct fresh fetch
 * (headless / unit). `staleTime: Infinity` + `revalidateIfStale` makes a write — not
 * elapsed time — the refresh trigger, exactly like `fetchEnergyDatasetShared`.
 *
 * NOTE: this is for NON-reactive consumers (the Share-tab loader, read cores). The
 * reactive `useBuildings` `useQueries` calls the raw {@link loadBuildingSource}, NOT
 * this — routing it through `ensureQueryData` on the SAME `["buildingSource", …]` key
 * the `useQueries` registers would deadlock on its own in-flight promise.
 */
export async function fetchBuildingSourceShared(
  sourceUri: string,
  gateway: PodGateway,
  storageRoot?: string,
): Promise<Building[]> {
  const load = () => loadBuildingSource(sourceUri, gateway, storageRoot);
  const qc = getAppQueryClient();
  if (!qc) return load();
  return qc.ensureQueryData({
    queryKey: buildingSourceKey(gateway.webId, sourceUri),
    queryFn: load,
    staleTime: Infinity,
    revalidateIfStale: true,
  });
}

/**
 * The building with this subject IRI from the WARM per-source cache (the `useBuildings`
 * fan-out's `["buildingSource", webId, sourceUri]` entries), or `null` when there's no app
 * client / it isn't cached. Lets React-free readers (the aggregation compute, the read
 * cores) reuse what the hooks loaded instead of re-reading the file.
 */
export function cachedBuilding(buildingUri: string): Building | null {
  const qc = getAppQueryClient();
  if (!qc) return null;
  const entries = qc.getQueriesData<Building[]>({
    predicate: (q) => q.queryKey[0] === queryKeys.buildingSource[0],
  });
  for (const [, data] of entries) {
    const b = data?.find((x) => x.uri === buildingUri);
    if (b) return b;
  }
  return null;
}

/**
 * Compose the visible building list from per-source `Building[]` results and the hidden
 * set: flatten, dropping any whose document IRI is hidden. The single derive-at-edge
 * selector both app-facing adapters call — the reactive `useBuildings` `combine` and the
 * imperative `cachedVisibleBuildings` peek — so the two can't diverge.
 */
export function visibleBuildings(
  perSource: ReadonlyArray<Building[] | undefined>,
  hidden: ReadonlySet<string>,
): Building[] {
  const out: Building[] = [];
  for (const data of perSource) {
    for (const b of data ?? []) {
      if (!hidden.has(buildingFileUri(b.uri))) out.push(b);
    }
  }
  return out;
}

/**
 * The hidden-building document IRIs from the WARM `["prefs", webId]` entry, or `null`
 * when prefs isn't cached (the caller then falls back to a fresh read rather than risk
 * showing a hidden building).
 */
export function cachedHiddenBuildings(webId: string): Set<string> | null {
  const qc = getAppQueryClient();
  if (!qc) return null;
  const prefs = qc.getQueryData<{ hiddenBuildings: Set<string> }>([...queryKeys.prefs, webId]);
  return prefs ? prefs.hiddenBuildings : null;
}

/**
 * The user's visible buildings from the WARM cache — the read-core equivalent of
 * `useBuildings`' result: flatten every cached per-source entry and drop hidden ones.
 * Returns `null` when the cache is COLD (no `["buildingsContainer", …]` entry → the
 * fan-out hasn't run) or prefs isn't warm, so the caller falls back to a full load rather
 * than trusting a partial / unfiltered peek.
 */
export function cachedVisibleBuildings(gateway: PodGateway): Building[] | null {
  const qc = getAppQueryClient();
  if (!qc) return null;
  // Cold cache: the buildings fan-out never ran → don't trust a partial set of sources.
  const containers = qc.getQueriesData<string[]>({
    predicate: (q) => q.queryKey[0] === queryKeys.buildingsContainer[0],
  });
  if (!containers.some(([, data]) => data !== undefined)) return null;
  const hidden = cachedHiddenBuildings(gateway.webId);
  if (hidden === null) return null; // prefs not warm → fall back (don't show a hidden one)

  const entries = qc.getQueriesData<Building[]>({
    predicate: (q) => q.queryKey[0] === queryKeys.buildingSource[0],
  });
  return visibleBuildings(entries.map(([, data]) => data), hidden);
}
