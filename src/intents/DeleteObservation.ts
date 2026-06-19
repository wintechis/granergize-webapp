// Intent core (React-free) for DeleteObservation (the hook is
// `useDeleteEnergyYear`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { deleteEnergyYear } from "../services/rdf/building/buildingSerializer.ts";
import type { EnergyDataset } from "../services/rdf/energyDataset.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the DeleteObservation intent. */
export interface DeleteObservationParams {
  /** The building file's IRI (the resource carrying the energy link). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The (year, granularity, scenario, featureOfInterest) selector of the dataset
   * to delete — FoI distinguishes a unit's series from the building's. */
  dataset: Pick<
    EnergyDataset,
    "year" | "granularity" | "scenario" | "featureOfInterest"
  >;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteEnergyYear}:
 * delete one annual energy dataset + its building link. The adapter owns the
 * building-data invalidation.
 */
export async function deleteObservationCore(
  gateway: PodGateway,
  params: DeleteObservationParams,
): Promise<Settled> {
  await deleteEnergyYear(gateway, params.fileUri, params.subjectUri, params.dataset);
  return { ok: true };
}
