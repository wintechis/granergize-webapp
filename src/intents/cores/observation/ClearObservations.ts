// Intent core (React-free) for ClearObservations (the hook is
// `useClearObservations`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { deleteEnergyYear } from "../../../services/rdf/building/buildingSerializer.ts";
import type { EnergyDataset } from "../../../services/energy/energyDataset.ts";
import type { Tally } from "../../outcomes.ts";
import { logError } from "../../../lib/logError.ts";

/** Parameters of the ClearObservations intent. */
export interface ClearObservationsParams {
  /** The building file's IRI (the resource carrying the energy links). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The (year, granularity, scenario, featureOfInterest) selectors of every
   * dataset to delete — the building's full link set for a "clear all". */
  datasets: Pick<
    EnergyDataset,
    "year" | "granularity" | "scenario" | "featureOfInterest"
  >[];
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useClearObservations}:
 * delete ALL of a building's observation datasets (every link), keeping the
 * building. Best-effort PER DATASET, like every other bulk core: one failed
 * delete is logged and counted, not thrown, so the healthy siblings still go —
 * and the {@link Tally} outcome makes a partial failure visible to the caller
 * (the finder toasts "cleared N of M" instead of lying about success). The
 * adapter owns the invalidation.
 */
export async function clearObservationsCore(
  gateway: PodGateway,
  params: ClearObservationsParams,
): Promise<Tally> {
  let done = 0;
  for (const dataset of params.datasets) {
    try {
      await deleteEnergyYear(gateway, params.fileUri, params.subjectUri, dataset);
      done++;
    } catch (err) {
      logError("clear building observations: delete one dataset", err);
    }
  }
  return { done, total: params.datasets.length };
}
