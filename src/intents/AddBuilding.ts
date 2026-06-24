// Intent core (React-free) for AddBuilding (the hook is `useUploadBuildings`).
// See ./README.md for the core/adapter split and the write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import {
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../services/rdf/building/buildingSerializer.ts";
import { mintBuildingSubject } from "../services/rdf/building/buildingId.ts";
import { rememberAgent } from "../services/savedAgents.ts";
import type { LastgangReading } from "../services/xlsx/energySeriesXlsx.ts";
import type { Aborted } from "./outcomes.ts";

/** The WebID-bearing master-data fields whose agents get auto-remembered. */
const AGENT_FIELDS = [
  "operatedBy",
  "ownedBy",
  "investor",
  "facilityManagedBy",
  "developedBy",
  "consultedBy",
] as const;

/** Parameters of the AddBuilding intent. */
export interface AddBuildingParams {
  /** One field map per building to create. */
  buildings: Array<Record<string, string>>;
  /** Optional 15-min Lastgang readings, grouped into a per-day series dataset. */
  lastgangReadings?: LastgangReading[] | null;
  /** Optional abort handle (runtime-only — not a modelled RDF param). */
  signal?: AbortSignal;
  /** Optional per-resource progress callback (runtime-only). */
  onProgress?: (done: number, total: number) => void;
}

/** AddBuilding outcome: the subject IRIs added, plus whether the user aborted. */
export interface AddBuildingOutcome extends Aborted {
  /** The subject IRIs of the buildings written before completion/abort. */
  added: string[];
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useUploadBuildings}:
 * per building, write energy datasets first and the discoverable building file
 * LAST (the commit point — a failure leaves only inert orphans), then
 * fire-and-forget auto-remember each WebID agent. A user cancel is an OUTCOME,
 * not an error — the core resolves with `aborted: true` and the buildings
 * already written; a real failure throws. The adapter owns the building-data
 * invalidation + the saved-agents cache priming.
 */
export async function addBuildingCore(
  gateway: PodGateway,
  params: AddBuildingParams,
): Promise<AddBuildingOutcome> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not authenticated");
  // Provenance records only WHO produced the building (the logged-in agent).
  const provenance = { agent: webId };
  const added: string[] = [];
  const signal = params.signal;
  try {
    for (const b of params.buildings) {
      signal?.throwIfAborted();
      // A collision-free FILE name: identity is the subject IRI, not the uuid.
      const uri = newBuildingUri(webId, crypto.randomUUID());
      const subjectUri = mintBuildingSubject(uri);

      // Group the Lastgang (15-min) readings by day into a single series
      // dataset; annual aggregates come from the field map (`_inv_*`/`_bsp_*`).
      let series:
        | {
          year: number;
          days: Array<{ date: string; readings: LastgangReading[] }>;
          label: string;
        }
        | undefined;
      if (params.lastgangReadings && params.lastgangReadings.length > 0) {
        const byDate = new Map<string, LastgangReading[]>();
        for (const r of params.lastgangReadings) {
          const list = byDate.get(r.date) ?? [];
          list.push(r);
          byDate.set(r.date, list);
        }
        const days = [...byDate.entries()].map(([date, readings]) => ({
          date,
          readings,
        }));
        // All readings are one calendar year; take it from the first date.
        const year = parseInt(days[0].date.slice(0, 4));
        series = { year, days, label: b.label ?? "" };
      }

      const energyLinks = await writeBuildingEnergy(
        gateway,
        uri,
        subjectUri,
        b,
        series,
        params.onProgress,
        signal,
      );
      const ttl = serializeBuildingToTurtle(b, uri, energyLinks, provenance);
      await uploadBuilding(gateway, uri, ttl, webId, signal);
      added.push(subjectUri);
      // Auto-remember the building's WebID agents. AWAIT the immediate cache write
      // (rememberAgent settles after it, before its background name-refine) so the
      // adapter's onSuccess contacts invalidation sees the new entries — a fire-and-
      // forget write races that refetch and the finder shows a stale empty book.
      // Sequentially, since agents.ttl's conditional PUT is inert and concurrent
      // read-modify-writes would clobber.
      for (const field of AGENT_FIELDS) {
        const value = b[field];
        if (typeof value === "string" && /^https?:\/\//.test(value)) {
          await rememberAgent(gateway, value);
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return { added, aborted: true };
    throw err;
  }
  return { added, aborted: false };
}
