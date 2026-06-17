// Intent core (React-free) for SaveObservation (the hook is `useWriteEnergyYear`).
// See ./README.md for the core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { writeEnergyYear } from "../services/rdf/building/buildingSerializer.ts";
import { reconcileBuildingGrants } from "../services/interop/share.ts";
import { logError } from "../lib/logError.ts";
import type { EnergyDataset } from "../services/rdf/energyDataset.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SaveObservation intent. */
export interface SaveObservationParams {
  /** The building file's IRI (the resource carrying the energy link). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The annual (year, scenario) energy dataset to create or replace. */
  dataset: EnergyDataset;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useWriteEnergyYear}:
 * write (create or replace) one annual energy dataset, then **reconcile** the
 * building's sharing grants — an active all-years grant must extend to the
 * dataset that now exists (its ACL projection is enumerated per dataset, so a
 * grown scope needs a re-apply). Reconciliation is DOMAIN logic, so it stays
 * inside the core; but it is best-effort: the year is already saved, so a failed
 * reconcile must NOT fail the save (the resulting drift is what `auditGrants`
 * detects and `reissueGrants` repairs). The adapter owns the building-data
 * invalidation.
 */
export async function saveObservationCore(
  gateway: PodGateway,
  params: SaveObservationParams,
): Promise<Settled> {
  await writeEnergyYear(gateway, params.fileUri, params.subjectUri, params.dataset);
  await reconcileBuildingGrants(params.fileUri, gateway).catch((err) =>
    logError("reconcile sharing grants after energy write", err)
  );
  return { ok: true };
}
