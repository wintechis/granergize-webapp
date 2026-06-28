import { DataFactory, Parser } from "n3";
import type { Quad } from "@rdfjs/types";
import type { Building } from "../../types.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { fetchFresh } from "../pod/podFetch.ts";
import { parseBuildings } from "../rdf/building/buildingParser.ts";

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
  const buildings = [...parseBuildings(quads, storageRoot).values()];
  // Ownership = whether the source file lives under the user's storage root.
  if (storageRoot !== undefined) {
    const isShared = !sourceUri.startsWith(storageRoot);
    for (const b of buildings) b.isShared = isShared;
  }
  return buildings;
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
  return ["buildingSource", webId, sourceUri] as const;
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
