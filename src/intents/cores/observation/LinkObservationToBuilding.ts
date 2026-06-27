// Intent core (React-free) for LinkObservationToBuilding (the hook is
// `useLinkObservationToBuilding`). See ./README.md for the core/adapter split.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { bindObservationToBuilding } from "../../../services/rdf/building/buildingSerializer.ts";
import { reconcileBuildingGrants } from "../../../services/interop/share.ts";
import { logError } from "../../../lib/logError.ts";
import type { Scenario } from "../../../services/energy/energyDataset.ts";
import type { Settled } from "../../outcomes.ts";

/** Parameters of the LinkObservationToBuilding intent — bind a building-less
 *  observation to a building (late FoI binding, in place). */
export interface LinkObservationToBuildingParams {
  /** The unbound observation's dataset node IRI (`#ds`). */
  observationUri: string;
  /** The target building's file IRI (gains the `cons:hasEnergyDataset` link). */
  buildingFileUri: string;
  /** The target building's subject IRI (`cons:ofBuilding`). */
  buildingSubjectUri: string;
  /** The dataset's granularity + scenario, for the building-side link ref. */
  granularity: string;
  scenario: Scenario;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useLinkObservationToBuilding}:
 * bind an unbound observation to a building (add `cons:ofBuilding` + the building link),
 * then **reconcile** the building's sharing grants — the newly-linked dataset joins an
 * active all-years grant's scope, exactly like a fresh save. Best-effort (the link is
 * already written; a failed reconcile is drift `auditGrants`/`reissueGrants` repair).
 */
export async function linkObservationToBuildingCore(
  gateway: PodGateway,
  params: LinkObservationToBuildingParams,
): Promise<Settled> {
  await bindObservationToBuilding(
    gateway,
    params.observationUri,
    params.buildingFileUri,
    params.buildingSubjectUri,
    { granularity: params.granularity, scenario: params.scenario },
  );
  await reconcileBuildingGrants(params.buildingFileUri, gateway).catch((err) =>
    logError("reconcile sharing grants after linking observation", err)
  );
  return { ok: true };
}
