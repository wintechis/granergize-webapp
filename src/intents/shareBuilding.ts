// Intent core (React-free) for ShareBuilding. See ./README.md for the
// core/adapter split and the write→outcome / read→value convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { shareBuildingData } from "../services/interop/share.ts";
import { rememberAgent } from "../services/contacts.ts";

/**
 * Parameters of the ShareBuilding intent. Mirrors the event-side signature in
 * `explore-intent-registry.md` §"A drafted registry entry", with the plural
 * `recipients` admitted as the batch unit (one grant event + ACL entry + inbox
 * notification per recipient — the §Open-questions compound-flow item).
 */
export interface ShareBuildingParams {
  /** The building's IRI (the `#b` subject's file is used for the grant). */
  buildingUri: string;
  /** WebIDs to grant read access to; shared sequentially. */
  recipients: string[];
  /** Include the building's energy datasets in the grant. */
  includeEnergyData: boolean;
  /** Restrict the energy grant to these years only. Absent = all years. */
  years?: number[];
  /**
   * Restrict the attachment grant to these file IRIs only. Absent = all
   * attachments (the `files/` container, incl. future uploads).
   */
  attachmentUris?: string[];
}

/**
 * A write intent's result is a minimal **outcome**, never a value (CQS at the
 * type level): a per-recipient tally of how many grants were committed.
 */
export interface ShareBuildingOutcome {
  /** Recipients granted (every recipient, since the loop stops at the first failure). */
  recipientsShared: number;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useShareBuilding}:
 * grant each recipient read access to a building. Sequential; stops at the first
 * failure (recipients already granted stay granted). Auto-remembers each granted
 * recipient in the address book (fire-and-forget).
 *
 * Holds exactly the Pod-request composition the hook's `mutationFn` used to; the
 * hook is now a thin adapter owning only busy state, the central toast, and the
 * `sharedOutLog` invalidation. Takes `gateway` as an argument — never calls
 * `getSession()`, imports no React/React Query — so it is callable headless
 * (a palette, a deep link, an LLM tool, the bench seeder, the Tier-2 runner).
 */
export async function shareBuildingCore(
  gateway: PodGateway,
  params: ShareBuildingParams,
): Promise<ShareBuildingOutcome> {
  let recipientsShared = 0;
  for (const recipient of params.recipients) {
    await shareBuildingData(params.buildingUri, recipient, gateway, {
      includeEnergyData: params.includeEnergyData,
      years: params.years,
      attachmentUris: params.attachmentUris,
    });
    // Auto-remember the recipient in the address book (fire-and-forget).
    void rememberAgent(gateway, recipient);
    recipientsShared++;
  }
  return { recipientsShared };
}
