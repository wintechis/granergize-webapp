// The React-free object-model interface for the intent catalog: name → core
// dispatch with Command–Query Separation enforced at the TYPE level. See
// ./README.md §"The invoke / query layer".
//
// This module imports the cores + the `PodGateway` port ONLY — no React, no
// `getSession`, no React Query — so a headless caller (a palette, a deep link,
// an LLM tool, the bench seeder, a Tier-2 runner) hits the same entry point the
// UI does. A `Session` satisfies `PodGateway`, so the React hooks pass
// `getSession()` straight through.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { shareBuildingCore } from "./cores/building/ShareBuilding.ts";
import { findBuildingsCore } from "./cores/building/FindBuildings.ts";
import { findNearbyInstallationsCore } from "./cores/installation/FindNearbyInstallations.ts";
import { findRegionalStatisticsCore } from "./cores/aggregation/FindRegionalStatistics.ts";
import { getBuildingCore } from "./cores/building/GetBuilding.ts";
import { getObservationYearCore } from "./cores/observation/GetObservationYear.ts";
import { whoHasAccessCore } from "./cores/sharing/WhoHasAccess.ts";
import { sharedWithMeCore } from "./cores/sharing/SharedWithMe.ts";
import { auditGrantsCore } from "./cores/sharing/AuditGrants.ts";
import { checkObservationLinksCore } from "./cores/observation/CheckObservationLinks.ts";
import { exportArchiveCore } from "./cores/appData/ExportArchive.ts";
import { createBuildingCore } from "./cores/building/CreateBuilding.ts";
import { updateBuildingCore } from "./cores/building/UpdateBuilding.ts";
import { deleteBuildingCore } from "./cores/building/DeleteBuilding.ts";
import { toggleVisibilityCore } from "./cores/building/ToggleVisibility.ts";
import { saveObservationCore } from "./cores/observation/SaveObservation.ts";
import { deleteObservationCore } from "./cores/observation/DeleteObservation.ts";
import { clearObservationsCore } from "./cores/observation/ClearObservations.ts";
import { linkObservationToBuildingCore } from "./cores/observation/LinkObservationToBuilding.ts";
import { uploadAttachmentsCore } from "./cores/attachment/UploadAttachments.ts";
import { deleteAttachmentCore } from "./cores/attachment/DeleteAttachment.ts";
import { setEnergyCertificateCore } from "./cores/attachment/SetEnergyCertificate.ts";
import { createAggregationCore } from "./cores/aggregation/CreateAggregation.ts";
import { deleteAggregationCore } from "./cores/aggregation/DeleteAggregation.ts";
import { refreshAggregationCore } from "./cores/aggregation/RefreshAggregation.ts";
import { revokeAggregationAccessCore } from "./cores/sharing/RevokeAggregationAccess.ts";
import { shareAggregationCore } from "./cores/aggregation/ShareAggregation.ts";
import { revokeBuildingAccessCore } from "./cores/sharing/RevokeBuildingAccess.ts";
import { drainInboxCore } from "./cores/sharing/DrainInbox.ts";
import { reissueGrantsCore } from "./cores/sharing/ReissueGrants.ts";
import { createRoomCore } from "./cores/room/CreateRoom.ts";
import { enterRoomCore } from "./cores/room/EnterRoom.ts";
import { exitRoomCore } from "./cores/room/ExitRoom.ts";
import { deleteRoomCore } from "./cores/room/DeleteRoom.ts";
import { addBookmarkCore } from "./cores/room/AddBookmark.ts";
import { removeBookmarkCore } from "./cores/room/RemoveBookmark.ts";
import { seedDemoRoomsCore } from "./cores/room/SeedDemoRooms.ts";
import { saveAgentCore } from "./cores/agent/SaveAgent.ts";
import { removeAgentCore } from "./cores/agent/RemoveAgent.ts";
import { seedDemoAgentsCore } from "./cores/agent/SeedDemoAgents.ts";
import { saveOrganisationCore } from "./cores/organisation/SaveOrganisation.ts";
import { deleteAppDataCore } from "./cores/appData/DeleteAppData.ts";
import { restoreArchiveCore } from "./cores/appData/RestoreArchive.ts";

/**
 * Write-effect cores keyed by the catalog `name`. Only **extracted** cores are
 * keys; Step 5 adds one line each as the remaining hooks gain cores. A write core
 * returns an OUTCOME (settled / a small tally), never a value.
 */
export const WRITE_CORES = {
  CreateBuilding: createBuildingCore,
  UpdateBuilding: updateBuildingCore,
  DeleteBuilding: deleteBuildingCore,
  ToggleVisibility: toggleVisibilityCore,
  ShareBuilding: shareBuildingCore,
  SaveObservation: saveObservationCore,
  DeleteObservation: deleteObservationCore,
  ClearObservations: clearObservationsCore,
  LinkObservationToBuilding: linkObservationToBuildingCore,
  UploadAttachments: uploadAttachmentsCore,
  DeleteAttachment: deleteAttachmentCore,
  SetEnergyCertificate: setEnergyCertificateCore,
  CreateAggregation: createAggregationCore,
  DeleteAggregation: deleteAggregationCore,
  RefreshAggregation: refreshAggregationCore,
  RevokeAggregationAccess: revokeAggregationAccessCore,
  ShareAggregation: shareAggregationCore,
  RevokeBuildingAccess: revokeBuildingAccessCore,
  // Paramless: the inbox drain / ACL rebuild are collection-wide. The `(s, _p)`
  // wrapper keeps every core's `(gateway, params)` arity uniform (see AuditGrants).
  DrainInbox: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return drainInboxCore(s);
  },
  ReissueGrants: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return reissueGrantsCore(s);
  },
  // ── Rooms ──────────────────────────────────────────────────────────────────
  // The 6 cache-patching cores return the normalized room URI / registry datum
  // the adapter's `patchRooms` race-guard folds into the cache (the reachability/
  // existence throws stay IN the core). SeedDemoRooms is paramless; CreateRoom
  // takes an optional room name.
  CreateRoom: createRoomCore,
  EnterRoom: enterRoomCore,
  ExitRoom: exitRoomCore,
  DeleteRoom: deleteRoomCore,
  AddBookmark: addBookmarkCore,
  RemoveBookmark: removeBookmarkCore,
  SeedDemoRooms: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return seedDemoRoomsCore(s);
  },
  // ── Agents ───────────────────────────────────────────────────────────────────
  SaveAgent: saveAgentCore,
  RemoveAgent: removeAgentCore,
  SeedDemoAgents: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return seedDemoAgentsCore(s);
  },
  // ── Organisation ─────────────────────────────────────────────────────────────
  SaveOrganisation: saveOrganisationCore,
  // ── Account ──────────────────────────────────────────────────────────────────
  DeleteAppData: deleteAppDataCore,
  RestoreArchive: restoreArchiveCore,
} as const;

/**
 * Read-effect cores keyed by the catalog `name`. A read core returns its VALUE
 * (the audit report, the archive blob). `AuditGrants` ignores its params (the
 * audit is collection-wide); `(s, _p) => …` keeps every core's `(gateway, params)`
 * arity so the dispatch types stay uniform.
 */
export const READ_CORES = {
  // AuditGrants is collection-wide — it takes no params. Declaring the empty
  // param type keeps every read core's `(gateway, params)` arity uniform; the
  // arg is read once into `void` so the dispatch maps stay homogeneous.
  AuditGrants: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return auditGrantsCore(s);
  },
  ExportArchive: exportArchiveCore,
  // Dev-mode: dry-run diff of observation `ofBuilding` ↔ building `hasEnergyDataset`
  // links (own-Pod). Collection-wide, so paramless — the `(s, _p)` wrapper keeps the
  // `(gateway, params)` arity uniform, like AuditGrants above.
  CheckObservationLinks: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return checkObservationLinksCore(s);
  },
  // The first collection query — narrows the visible buildings by an attribute
  // selector (plan-attribute-facets); returns the matching Building[].
  FindBuildings: findBuildingsCore,
  // Open tier: federated read of MaStR generation units near a building (off-Pod).
  FindNearbyInstallations: findNearbyInstallationsCore,
  // Open tier: the public regionalstatistik datasets available for a region.
  FindRegionalStatistics: findRegionalStatisticsCore,
  // Single-entity + relationship reads (§8 taxonomy).
  GetBuilding: getBuildingCore,
  GetObservationYear: getObservationYearCore,
  WhoHasAccess: whoHasAccessCore,
  SharedWithMe: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return sharedWithMeCore(s);
  },
} as const;

/** A catalog name that has an extracted **write** core. */
export type WriteIntentName = keyof typeof WRITE_CORES;
/** A catalog name that has an extracted **read** core. */
export type ReadIntentName = keyof typeof READ_CORES;

/** The TS param type a write/read core accepts (Step 2's binding target). */
export type CoreParams<N extends WriteIntentName | ReadIntentName> =
  N extends WriteIntentName ? Parameters<(typeof WRITE_CORES)[N]>[1]
    : N extends ReadIntentName ? Parameters<(typeof READ_CORES)[N]>[1]
    : never;

/** The OUTCOME a write core resolves to. */
export type WriteOutcome<N extends WriteIntentName> = Awaited<
  ReturnType<(typeof WRITE_CORES)[N]>
>;

/** The VALUE a read core resolves to. */
export type ReadValue<N extends ReadIntentName> = Awaited<
  ReturnType<(typeof READ_CORES)[N]>
>;

/**
 * Thrown by {@link invokeByName}/{@link queryByName} when a name has no extracted
 * core — a **clear error, never a silent fallback** (a missing core is a Step-5
 * gap, not a recoverable condition). `kind` says which channel was asked.
 */
export class IntentNotInvocableError extends Error {
  // `name` is a plain param (used in the message), NOT a property: a `readonly name`
  // param-property would shadow `Error.name` and then be overwritten by the
  // assignment below — pointless, and it trips `noImplicitOverride`.
  constructor(
    name: string,
    readonly kind: "write" | "read",
  ) {
    super(`Intent "${name}" has no extracted ${kind} core (not invocable yet)`);
    this.name = "IntentNotInvocableError";
  }
}

/**
 * Invoke a **write** intent by its statically-known catalog name. CQS is enforced
 * by the type: passing a READ name is a compile error (the name isn't a
 * {@link WriteIntentName}), so there is no runtime `effect` switch.
 */
export function invoke<N extends WriteIntentName>(
  name: N,
  params: CoreParams<N>,
  gateway: PodGateway,
): Promise<WriteOutcome<N>> {
  const core = WRITE_CORES[name] as unknown as (
    s: PodGateway,
    p: CoreParams<N>,
  ) => Promise<WriteOutcome<N>>;
  return core(gateway, params);
}

/**
 * Query a **read** intent by its statically-known catalog name. CQS is enforced
 * by the type: passing a WRITE name is a compile error.
 */
export function query<N extends ReadIntentName>(
  name: N,
  params: CoreParams<N>,
  gateway: PodGateway,
): Promise<ReadValue<N>> {
  const core = READ_CORES[name] as unknown as (
    s: PodGateway,
    p: CoreParams<N>,
  ) => Promise<ReadValue<N>>;
  return core(gateway, params);
}

/**
 * Dynamic write dispatch from a runtime string (the palette passing
 * `IntentEntry.name`). Throws {@link IntentNotInvocableError} for any name without
 * an extracted write core.
 */
export function invokeByName(
  name: string,
  params: unknown,
  gateway: PodGateway,
): Promise<unknown> {
  if (!(name in WRITE_CORES)) {
    throw new IntentNotInvocableError(name, "write");
  }
  return invoke(
    name as WriteIntentName,
    params as CoreParams<WriteIntentName>,
    gateway,
  );
}

/**
 * Dynamic read dispatch from a runtime string. Throws
 * {@link IntentNotInvocableError} for any name without an extracted read core.
 */
export function queryByName(
  name: string,
  params: unknown,
  gateway: PodGateway,
): Promise<unknown> {
  if (!(name in READ_CORES)) {
    throw new IntentNotInvocableError(name, "read");
  }
  return query(
    name as ReadIntentName,
    params as CoreParams<ReadIntentName>,
    gateway,
  );
}
