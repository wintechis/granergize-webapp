// Intent core (React-free) for DeleteObservation (the hook is
// `useDeleteEnergyYear`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  deleteBuildinglessObservation,
  deleteEnergyYear,
} from "../../../services/rdf/building/buildingSerializer.ts";
import type { EnergyDataset } from "../../../services/energy/energyDataset.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the DeleteObservation intent. A building-linked dataset is selected by
 *  `fileUri` + `subjectUri` + `dataset`; a **building-less** observation by its
 *  `observationUri` (no building link to unlink). */
export interface DeleteObservationParams {
  /** The building file's IRI (the resource carrying the energy link). */
  fileUri?: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri?: string;
  /** The (year, granularity, scenario, featureOfInterest) selector of the dataset
   * to delete — FoI distinguishes a unit's series from the building's. */
  dataset?: Pick<
    EnergyDataset,
    "year" | "granularity" | "scenario" | "featureOfInterest"
  >;
  /** Building-less: the unbound observation's node IRI to delete. */
  observationUri?: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteEnergyYear}:
 * delete one annual energy dataset. A building-linked dataset is removed WITH its
 * building link; a building-less one (`observationUri`) is just deleted. The adapter
 * owns the invalidation.
 */
export async function deleteObservationCore(
  gateway: PodGateway,
  params: DeleteObservationParams,
): Promise<Settled> {
  if (params.observationUri) {
    await deleteBuildinglessObservation(gateway, params.observationUri);
    return { ok: true };
  }
  await deleteEnergyYear(
    gateway,
    params.fileUri!,
    params.subjectUri!,
    params.dataset!,
  );
  return { ok: true };
}
