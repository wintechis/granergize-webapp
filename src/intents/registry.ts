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
import { shareBuildingCore } from "./shareBuilding.ts";
import { findBuildingsCore } from "./FindBuildings.ts";
import { checkSharingConsistencyCore } from "./checkSharingConsistency.ts";
import { exportArchiveCore } from "./exportArchive.ts";
import { addBuildingCore } from "./AddBuilding.ts";
import { updateBuildingCore } from "./UpdateBuilding.ts";
import { deleteBuildingCore } from "./DeleteBuilding.ts";
import { toggleVisibilityCore } from "./ToggleVisibility.ts";
import { saveObservationCore } from "./SaveObservation.ts";
import { deleteObservationCore } from "./DeleteObservation.ts";
import { uploadAttachmentsCore } from "./UploadAttachments.ts";
import { deleteAttachmentCore } from "./DeleteAttachment.ts";
import { setEnergyCertificateCore } from "./SetEnergyCertificate.ts";
import { createAggregationCore } from "./CreateAggregation.ts";
import { deleteAggregationCore } from "./DeleteAggregation.ts";
import { refreshAggregationCore } from "./RefreshAggregation.ts";
import { revokeAggregationAccessCore } from "./RevokeAggregationAccess.ts";
import { shareAggregationCore } from "./ShareAggregation.ts";
import { revokeBuildingAccessCore } from "./RevokeBuildingAccess.ts";
import { checkInboxCore } from "./CheckInbox.ts";
import { reissueGrantsCore } from "./ReissueGrants.ts";
import { createRoomCore } from "./CreateRoom.ts";
import { enterRoomCore } from "./EnterRoom.ts";
import { exitRoomCore } from "./ExitRoom.ts";
import { deleteRoomCore } from "./DeleteRoom.ts";
import { addRoomCore } from "./AddRoom.ts";
import { removeBookmarkCore } from "./RemoveBookmark.ts";
import { saveRolesCore } from "./SaveRoles.ts";
import { seedDemoRoomsCore } from "./SeedDemoRooms.ts";
import { saveContactCore } from "./SaveContact.ts";
import { removeContactCore } from "./RemoveContact.ts";
import { seedDemoContactsCore } from "./SeedDemoContacts.ts";
import { saveOrganisationCore } from "./SaveOrganisation.ts";
import { seedDemoBuildingsCore } from "./SeedDemoBuildings.ts";
import { removeAppDataCore } from "./RemoveAppData.ts";
import { restoreArchiveCore } from "./RestoreArchive.ts";

/**
 * Write-effect cores keyed by the catalog `name`. Only **extracted** cores are
 * keys; Step 5 adds one line each as the remaining hooks gain cores. A write core
 * returns an OUTCOME (settled / a small tally), never a value.
 */
export const WRITE_CORES = {
  AddBuilding: addBuildingCore,
  UpdateBuilding: updateBuildingCore,
  DeleteBuilding: deleteBuildingCore,
  ToggleVisibility: toggleVisibilityCore,
  ShareBuilding: shareBuildingCore,
  SaveObservation: saveObservationCore,
  DeleteObservation: deleteObservationCore,
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
  CheckInbox: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return checkInboxCore(s);
  },
  ReissueGrants: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return reissueGrantsCore(s);
  },
  // ── Rooms ──────────────────────────────────────────────────────────────────
  // The 6 cache-patching cores return the normalized room URI / registry datum
  // the adapter's `patchRooms` race-guard folds into the cache (the reachability/
  // existence throws stay IN the core). CreateRoom + SeedDemoRooms are paramless.
  CreateRoom: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return createRoomCore(s);
  },
  EnterRoom: enterRoomCore,
  ExitRoom: exitRoomCore,
  DeleteRoom: deleteRoomCore,
  AddRoom: addRoomCore,
  RemoveBookmark: removeBookmarkCore,
  SaveRoles: saveRolesCore,
  SeedDemoRooms: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return seedDemoRoomsCore(s);
  },
  // ── Contacts ─────────────────────────────────────────────────────────────────
  SaveContact: saveContactCore,
  RemoveContact: removeContactCore,
  SeedDemoContacts: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return seedDemoContactsCore(s);
  },
  // ── Organisation ─────────────────────────────────────────────────────────────
  SaveOrganisation: saveOrganisationCore,
  // ── Account ──────────────────────────────────────────────────────────────────
  SeedDemoBuildings: (s: PodGateway, p: Record<never, never>) => {
    void p;
    return seedDemoBuildingsCore(s);
  },
  RemoveAppData: removeAppDataCore,
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
    return checkSharingConsistencyCore(s);
  },
  ExportArchive: exportArchiveCore,
  // The first collection query — narrows the visible buildings by an attribute
  // selector (plan-attribute-facets); returns the matching BuildingType[].
  FindBuildings: findBuildingsCore,
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
