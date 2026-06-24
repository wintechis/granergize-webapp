// Intent core (React-free) for UpdateBuilding. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { updateBuilding } from "../services/rdf/building/buildingSerializer.ts";
import { rememberAgent } from "../services/savedAgents.ts";
import type { TechnicalSystem } from "../types.ts";
import type { Settled } from "./outcomes.ts";

/** The WebID-bearing master-data fields whose agents get auto-remembered. */
const AGENT_FIELDS = [
  "operatedBy",
  "ownedBy",
  "investor",
  "facilityManagedBy",
  "developedBy",
  "consultedBy",
] as const;

/** Parameters of the UpdateBuilding intent. */
export interface UpdateBuildingParams {
  /** The building file's IRI (the resource conditionally rewritten). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The edited master-data field map. */
  fields: Record<string, string>;
  /** When given, the full energy-unit list to replace the building's with (the
   * per-unit editor). Omitted on a plain field edit → units left untouched. */
  systems?: TechnicalSystem[];
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useUpdateBuilding}:
 * save edited master data on an existing building (conditional RMW PUT), then
 * fire-and-forget auto-remember each WebID-bearing agent field in the address
 * book (mirroring `shareBuildingCore`'s `void rememberAgent`).
 *
 * The address-book *cache priming* (the adapter's `onSuccess`
 * `invalidateQueries({contacts})`, so an inactive Connect picks up the new
 * contacts) is a query-cache concern, not a Pod write, so it stays in the hook.
 * The core does only the Pod composition + the remember writes.
 */
export async function updateBuildingCore(
  gateway: PodGateway,
  params: UpdateBuildingParams,
): Promise<Settled> {
  await updateBuilding(
    gateway,
    params.fileUri,
    params.subjectUri,
    params.fields,
    params.systems,
  );
  // Auto-remember each WebID agent. AWAIT the immediate cache write (rememberAgent
  // settles after it, before its background name-refine) so the adapter's onSuccess
  // contacts invalidation sees the new entries instead of racing them. Sequentially,
  // since agents.ttl's conditional PUT is inert and concurrent writes would clobber.
  for (const field of AGENT_FIELDS) {
    const value = params.fields[field];
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      await rememberAgent(gateway, value);
    }
  }
  return { ok: true };
}
