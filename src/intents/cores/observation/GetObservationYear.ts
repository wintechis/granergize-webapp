/**
 * `GetObservationYear` — a single-entity read (`plan-intent-core.md` §8): the annual
 * energy observation for one building and year ("building X's electricity in 2024").
 * Reads the building from the warm cache (`cachedBuilding`), else resolves it
 * (EntityQuery), then loads its actual, non-series annual datasets through the shared
 * per-dataset cache (`fetchEnergyDatasetsShared` — the same `["energyDataset", …]` entries
 * the map filled) and returns the matching year's metrics. Returns `null` when the
 * building or that year is absent.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { Building } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";
import {
  type AnnualMetrics,
  type EnergyDataset,
  type EnergyDatasetRef,
} from "../../../services/energy/energyDataset.ts";
import { fetchEnergyDatasetsShared } from "../../../services/energy/energyDatasetCache.ts";
import { cachedBuilding } from "../../../services/building/buildingSource.ts";
import { isSeriesGranularity } from "../../../services/rdf/durationUtils.ts";

export interface GetObservationYearParams {
  /** The building's subject/document IRI. */
  building: string;
  /** The observation year. */
  year: number;
}

/** The metrics for one building-year, or null if there's no such observation. */
export interface ObservationYear {
  building: string;
  year: number;
  metrics: AnnualMetrics;
}

/** Injectable dataset loader (defaults to the real fresh-fetch + parse). */
export type LoadDatasets = (
  refs: EnergyDatasetRef[],
  gateway: PodGateway,
) => Promise<EnergyDataset[]>;
const defaultLoad: LoadDatasets = (refs, gateway) =>
  fetchEnergyDatasetsShared(refs, gateway);

export async function getObservationYearCore(
  gateway: PodGateway,
  params: GetObservationYearParams,
  load: LoadDatasets = defaultLoad,
): Promise<ObservationYear | null> {
  const obj = cachedBuilding(params.building) ??
    await resolve("building", params.building, gateway);
  if (!obj || !("energyDatasets" in obj)) return null;
  const b = obj as Building;
  const year = Number(params.year);

  // Actual, non-series (annual) datasets — the same filter the by-year hook applies.
  const refs = (b.energyDatasets ?? []).filter(
    (r) => r.scenario === "actual" && !isSeriesGranularity(r.granularity),
  );
  if (refs.length === 0) return null;

  const datasets = await load(refs, gateway);
  const ds = datasets.find((d) => d.year === year && d.metrics);
  return ds && ds.metrics ? { building: b.uri, year, metrics: ds.metrics } : null;
}
