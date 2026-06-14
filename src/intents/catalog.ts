/**
 * The app-intent catalog — the action profile reified as data.
 *
 * Phase-0 contract **C3** of the redesign (see `plans/plan-redesign-parallel-execution.md`):
 * this freezes the *shape* (the {@link IntentEntry} type) plus a representative seed,
 * so the command-palette and RowAction lanes code against one enumerable catalog
 * instead of reading `mutations.ts` by eye. The full population — one entry per
 * mutation hook, with the hooks *deriving* their `meta.action`/invalidations from
 * here, plus the drift guard against `mutations.ts` — is the **L-intent-registry**
 * lane. Design + the full Actions list: `explore/explore-intent-registry.md`.
 *
 * Entity names use the locked target grammar (`observation`, `aggregation`); the
 * code hooks still say `energy` until the L-observations rename.
 */

/** Which state space a verb acts on (the top-level discriminator, CQS-aligned). */
export type IntentEffect =
  | "write" // a Pod mutation; result is the effect + invalidations
  | "read" // a user-invoked one-shot read; result is the returned value
  | "navigate"; // enters an addressable UI state; result is the state itself

/** The first-class entity a verb targets (absent for collection-wide verbs). */
export type IntentEntity =
  | "building"
  | "observation"
  | "aggregation"
  | "room"
  | "contact"
  | "organisation"
  | "attachment"
  | "sharing"
  | "appData";

/** Standard vs. developer-gated affordance (dev mode); see CLAUDE.md Developer mode. */
export type IntentExposure = "standard" | "developer";

/** One reified intent. The shape is the contract; fields fill in over the lanes. */
export interface IntentEntry {
  /** Local name; also the `int:` IRI stem. Unique across the catalog. */
  readonly name: string;
  /** The `meta.action` phrase ("share the building") — the `"Failed to {action}"` tail. */
  readonly action: string;
  /** Which state space it acts on. */
  readonly effect: IntentEffect;
  /** The entity it targets, if any. */
  readonly entity?: IntentEntity;
  /** Errors shown inline (`<Alert>`) rather than via the central toast (`meta.silent`). */
  readonly silentError?: boolean;
  /** Developer-gated affordance. Defaults to `"standard"`. */
  readonly exposure?: IntentExposure;
  /** The implementing hook in `src/hooks/mutations.ts`, for the drift guard. */
  readonly hook: string;
}

/**
 * The exhaustive catalog — one entry per user-intent hook exported from
 * `src/hooks/mutations.ts`. The {@link catalog.drift.test.ts} drift guard keeps
 * this in lockstep with `mutations.ts`: every `hook` must exist there, and where
 * a hook declares `meta.action` the entry's `action` must match it verbatim.
 *
 * Hooks that declare NO `meta.action` carry `action: ""` here (their error
 * surfaces are handled outside the central `"Failed to {action}"` toast — most
 * patch the cache authoritatively or render inline). Entity names use the locked
 * target grammar (`observation`/`aggregation`); the code hooks still say
 * `energy` until the L-observations rename.
 */
export const INTENTS: readonly IntentEntry[] = [
  // ── Buildings ──────────────────────────────────────────────────────────────
  {
    name: "AddBuilding",
    action: "add the building",
    effect: "write",
    entity: "building",
    hook: "useUploadBuildings",
  },
  {
    name: "UpdateBuilding",
    action: "update the building",
    effect: "write",
    entity: "building",
    hook: "useUpdateBuilding",
  },
  {
    name: "DeleteBuilding",
    action: "", // hook declares no meta.action (caller confirms; cache patched)
    effect: "write",
    entity: "building",
    hook: "useDeleteBuilding",
  },
  {
    name: "ToggleVisibility",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "building",
    hook: "useToggleVisibility",
  },
  // ── Energy (observations) ────────────────────────────────────────────────────
  {
    name: "SaveObservation", // hook: energy year (rename lands in L-observations)
    action: "save energy data",
    effect: "write",
    entity: "observation",
    hook: "useWriteEnergyYear",
  },
  {
    name: "DeleteObservation", // hook: energy year (rename lands in L-observations)
    action: "delete energy data",
    effect: "write",
    entity: "observation",
    hook: "useDeleteEnergyYear",
  },
  // ── Attachments ──────────────────────────────────────────────────────────────
  {
    name: "UploadAttachments",
    action: "upload the file",
    effect: "write",
    entity: "attachment",
    hook: "useUploadAttachments",
  },
  {
    name: "DeleteAttachment",
    action: "delete the file",
    effect: "write",
    entity: "attachment",
    hook: "useDeleteAttachment",
  },
  {
    name: "SetEnergyCertificate",
    action: "update the energy certificate",
    effect: "write",
    entity: "attachment",
    hook: "useSetEnergyCertificate",
  },
  // ── Aggregations ─────────────────────────────────────────────────────────────
  {
    name: "CreateAggregation",
    action: "create the aggregation",
    effect: "write",
    entity: "aggregation",
    hook: "useCreateAggregation",
  },
  {
    name: "DeleteAggregation",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "aggregation",
    hook: "useDeleteAggregation",
  },
  {
    name: "RefreshAggregation",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "aggregation",
    hook: "useRefreshAggregation",
  },
  {
    name: "ShareAggregation",
    action: "share the aggregation",
    effect: "write",
    entity: "aggregation",
    silentError: true, // share-aggregation dialog renders inline (silent: opts.silent)
    hook: "useShareAggregationSnapshot",
  },
  {
    name: "RevokeAggregationAccess",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "sharing",
    hook: "useRevokeAggregationAccess",
  },
  // ── Sharing ──────────────────────────────────────────────────────────────────
  {
    name: "ShareBuilding",
    action: "share the building",
    effect: "write",
    entity: "building",
    silentError: true,
    hook: "useShareBuilding",
  },
  {
    name: "RevokeBuildingAccess",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "sharing",
    hook: "useRevokeBuildingAccess",
  },
  {
    name: "CheckInbox",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "sharing",
    exposure: "developer",
    hook: "useCheckInbox",
  },
  {
    name: "ReissueGrants",
    action: "rebuild sharing",
    effect: "write",
    entity: "sharing",
    exposure: "developer",
    hook: "useReissueGrants",
  },
  {
    name: "AuditGrants",
    action: "check sharing consistency",
    effect: "read",
    entity: "sharing",
    exposure: "developer",
    hook: "useAuditGrants",
  },
  // ── Organisation ─────────────────────────────────────────────────────────────
  {
    name: "SaveOrganisation",
    action: "save your organisation",
    effect: "write",
    entity: "organisation",
    hook: "useSaveOrganization",
  },
  // ── Contacts ─────────────────────────────────────────────────────────────────
  {
    name: "SaveContact",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "contact",
    hook: "useSaveContact",
  },
  {
    name: "RemoveContact",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "contact",
    hook: "useRemoveContact",
  },
  {
    name: "SeedDemoContacts",
    action: "add demo contacts",
    effect: "write",
    entity: "contact",
    exposure: "developer",
    hook: "useSeedDemoContacts",
  },
  // ── Data rooms ───────────────────────────────────────────────────────────────
  {
    name: "CreateRoom",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useCreateRoom",
  },
  {
    name: "EnterRoom",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useEnterRoom",
  },
  {
    name: "ExitRoom",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useExitRoom",
  },
  {
    name: "DeleteRoom",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useDeleteRoom",
  },
  {
    name: "AddRoom",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useAddRoom",
  },
  {
    name: "RemoveBookmark",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useRemoveBookmark",
  },
  {
    name: "SaveRoles",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "room",
    hook: "useSaveRoles",
  },
  {
    name: "SeedDemoRooms",
    action: "add demo data rooms",
    effect: "write",
    entity: "room",
    exposure: "developer",
    hook: "useSeedDemoRooms",
  },
  // ── Account-scope ────────────────────────────────────────────────────────────
  {
    name: "SeedDemoBuildings",
    action: "add demo buildings and energy data",
    effect: "write",
    entity: "building",
    exposure: "developer",
    hook: "useSeedDemoBuildings",
  },
  {
    name: "RemoveAppData",
    action: "remove app data",
    effect: "write",
    entity: "appData",
    exposure: "developer",
    hook: "useRemoveAppData",
  },
  {
    name: "RestoreArchive",
    action: "restore the archive",
    effect: "write",
    entity: "appData",
    exposure: "developer",
    hook: "useRestoreArchive",
  },
  {
    name: "ExportArchive",
    action: "download the archive",
    effect: "read",
    entity: "appData",
    exposure: "developer",
    hook: "useExportArchive",
  },
] as const;

/** Resolve the active exposure (default `"standard"`). */
export const intentExposure = (e: IntentEntry): IntentExposure =>
  e.exposure ?? "standard";
