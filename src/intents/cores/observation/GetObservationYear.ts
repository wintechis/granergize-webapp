/**
 * `GetObservationYear` — a single-entity read (`plan-intent-core.md` §8): the annual
 * energy observation for one building and year ("building X's electricity in 2024").
 * Resolves the building (EntityQuery), then loads its actual, non-series annual
 * datasets and returns the matching year's metrics. Returns `null` when the building
 * or that year is absent. Composes the same single-resource reads + parsers the
 * by-year energy hook uses, headlessly.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { BuildingType } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";
import {
  type AnnualMetrics,
  type EnergyDataset,
  type EnergyDatasetRef,
  loadEnergyDatasets,
} from "../../../services/energy/energyDataset.ts";
import { isSeriesGranularity } from "../../../services/rdf/durationUtils.ts";
import { fetchFresh } from "../../../services/pod/podFetch.ts";

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
  loadEnergyDatasets(refs, (uri) => fetchFresh(uri, gateway));

export async function getObservationYearCore(
  gateway: PodGateway,
  params: GetObservationYearParams,
  load: LoadDatasets = defaultLoad,
): Promise<ObservationYear | null> {
  const obj = await resolve("building", params.building, gateway);
  if (!obj || !("energyDatasets" in obj)) return null;
  const b = obj as BuildingType;
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
