import type { PodGateway } from "../pod/podGateway.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { fetchFresh } from "../pod/podFetch.ts";
import {
  type EnergyDataset,
  type EnergyDatasetRef,
  loadEnergyDataset,
} from "./energyDataset.ts";

/**
 * The React Query key for one energy dataset, keyed by its node IRI — the first
 * `resource-keyed` query in the ldp-query-layer direction (see
 * `plans/plan-ldp-query-layer.md`). Namespaced by WebID like the other keys so a
 * re-login can't read another user's cache; energy/building writes invalidate the
 * `["energyDataset"]` prefix through `invalidateBuildingData` (`hooks/mutations.ts`).
 */
export function energyDatasetKey(webId: string, datasetUri: string) {
  return ["energyDataset", webId, datasetUri] as const;
}

/**
 * The canonical {@link EnergyDataset} for a dataset node IRI, read **once** across
 * every consumer: when the app is mounted it goes through the warm query cache
 * (`ensureQueryData` dedupes by key, so the map's fold and the aggregation compute
 * share a single Pod read); when no client is published (headless / unit) it falls
 * back to a direct fresh fetch. `staleTime: Infinity` makes a write — not elapsed
 * time — the refresh trigger, matching how energy freshness already works (the
 * `energyKeyFor` fold only refreshes on `invalidateBuildingData`). Returns `null`
 * for an unreadable dataset (access revoked / 404), which callers tolerate.
 */
export async function fetchEnergyDatasetShared(
  datasetUri: string,
  gateway: PodGateway,
): Promise<EnergyDataset | null> {
  const load = () =>
    loadEnergyDataset(datasetUri, (uri) => fetchFresh(uri, gateway));
  const qc = getAppQueryClient();
  if (!qc) return load();
  return qc.ensureQueryData({
    queryKey: energyDatasetKey(gateway.webId, datasetUri),
    queryFn: load,
    // `staleTime: Infinity` => a normal read returns the warm entry (read-once);
    // `revalidateIfStale` => an entry a write *invalidated* refetches on next read.
    // Without it `ensureQueryData` serves the stale copy forever and the mutation
    // invalidation is inert.
    staleTime: Infinity,
    revalidateIfStale: true,
  });
}

/**
 * Load a set of energy datasets, each through the shared per-resource cache — the
 * single-read-path equivalent of `loadEnergyDatasets`. Reuses the warm entries the
 * map fold / aggregation compute already filled (one Pod read per dataset across all
 * consumers); unreadable datasets are dropped. Use this over `loadEnergyDatasets`
 * wherever a gateway is in hand (detail-pane hooks, the series compute).
 */
export async function fetchEnergyDatasetsShared(
  refs: readonly EnergyDatasetRef[],
  gateway: PodGateway,
): Promise<EnergyDataset[]> {
  const loaded = await Promise.all(
    refs.map((ref) => fetchEnergyDatasetShared(ref.uri, gateway)),
  );
  return loaded.filter((ds): ds is EnergyDataset => ds !== null);
}
