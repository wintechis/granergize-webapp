/**
 * The app-intent catalog — the action profile reified as data.
 *
 * Phase-0 contract **C3** of the redesign (see `plans/plan-redesign-parallel-execution.md`):
 * this freezes the *shape* (the {@link IntentEntry} type) plus a representative seed,
 * so the command-palette and the per-object `ObjectActions` menu code against one
 * enumerable catalog instead of reading `mutations.ts` by eye. The full population — one entry per
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
  | "installation" // a public generation unit (the `open` tier, MaStR); not Pod-backed
  | "room"
  | "agent"
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
  /** The implementing hook in `src/hooks/mutations.ts`, for the drift guard.
   * Absent for `navigate` intents — they have no Pod hook (their core is a pure
   * route builder, `navigate.ts`); the drift guard checks `hook` only where set. */
  readonly hook?: string;
}

/**
 * The intent **verb lexicon** — `name` is `Verb` + `Object`, and each verb has a
 * fixed meaning, so a reader infers an intent's effect from its name alone:
 *
 * - **Create** — mint a brand-new resource (`CreateBuilding`, `CreateAggregation`,
 *   `CreateRoom`).
 * - **Add** — bring an *existing* thing into a collection, minting no resource
 *   (`AddBookmark` = bookmark an existing room).
 * - **Delete** — destroy an owned resource (`DeleteBuilding`, `DeleteAppData`).
 * - **Remove** — unlink a *reference*; the referent survives (`RemoveAgent` drops
 *   an address-book entry, `RemoveBookmark` drops a room bookmark).
 * - **Save** — upsert a whole resource (`SaveObservation`, `SaveAgent`); **Update**
 *   — partial edit of an existing one (`UpdateBuilding`); **Set** — one attribute
 *   (`SetEnergyCertificate`).
 * - **Get** — read one resource; **Find** — read a collection.
 * - **Share** / **Revoke** — grant / withdraw access. **Seed** — demo fixtures.
 * - A read verb never mutates (e.g. `DrainInbox` is a *write* — `Check`/`Audit`
 *   reads like `CheckObservationLinks`/`AuditGrants` only ever read).
 *
 * The UI label (`labels.ts`) may be a friendlier *synonym* (e.g. "Check for new
 * shares" for `DrainInbox`, "Edit" for `UpdateBuilding`) as long as it doesn't
 * imply a *different* operation. The `hook` field names a React hook, a separate
 * layer whose name need not match the intent (`useUploadBuildings` ↔ `CreateBuilding`).
 *
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
    name: "CreateBuilding",
    action: "actionCreateBuilding",
    effect: "write",
    entity: "building",
    hook: "useUploadBuildings",
  },
  {
    name: "UpdateBuilding",
    action: "actionUpdateBuilding",
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
  // ── Queries (reads) ──────────────────────────────────────────────────────────
  {
    name: "FindBuildings",
    action: "", // a read; no meta.action
    effect: "read",
    entity: "building",
    hook: "useFindBuildings",
  },
  {
    name: "FindNearbyInstallations", // open tier: MaStR generation units near a building
    action: "", // a federated read; no meta.action
    effect: "read",
    entity: "installation",
    hook: "useFindNearbyInstallations",
  },
  {
    name: "FindRegionalStatistics", // open tier: public regionalstatistik datasets for a region
    action: "", // a read; no meta.action
    effect: "read",
    entity: "aggregation",
    hook: "useFindRegionalStatistics",
  },
  {
    name: "GetBuilding",
    action: "",
    effect: "read",
    entity: "building",
    hook: "useGetBuilding",
  },
  {
    name: "GetObservationYear",
    action: "",
    effect: "read",
    entity: "observation",
    hook: "useGetObservationYear",
  },
  {
    name: "WhoHasAccess",
    action: "",
    effect: "read",
    entity: "sharing",
    hook: "useWhoHasAccess",
  },
  {
    name: "SharedWithMe",
    action: "",
    effect: "read",
    entity: "sharing",
    hook: "useSharedWithMe",
  },
  // ── Energy (observations) ────────────────────────────────────────────────────
  {
    name: "SaveObservation", // hook: energy year (rename lands in L-observations)
    action: "actionSaveEnergy",
    effect: "write",
    entity: "observation",
    hook: "useWriteEnergyYear",
  },
  {
    name: "DeleteObservation", // hook: energy year (rename lands in L-observations)
    action: "actionDeleteEnergy",
    effect: "write",
    entity: "observation",
    hook: "useDeleteEnergyYear",
  },
  {
    name: "ClearObservations", // delete ALL of a building's observation datasets
    action: "actionClearObservations",
    effect: "write",
    entity: "observation",
    hook: "useClearObservations",
  },
  {
    name: "LinkObservationToBuilding", // bind a building-less observation to a building
    action: "actionLinkObservation",
    effect: "write",
    entity: "observation",
    hook: "useLinkObservationToBuilding",
  },
  // ── Attachments ──────────────────────────────────────────────────────────────
  {
    name: "UploadAttachments",
    action: "actionUploadFile",
    effect: "write",
    entity: "attachment",
    hook: "useUploadAttachments",
  },
  {
    name: "DeleteAttachment",
    action: "actionDeleteFile",
    effect: "write",
    entity: "attachment",
    hook: "useDeleteAttachment",
  },
  {
    name: "SetEnergyCertificate",
    action: "actionUpdateCertificate",
    effect: "write",
    entity: "attachment",
    hook: "useSetEnergyCertificate",
  },
  // ── Aggregations ─────────────────────────────────────────────────────────────
  {
    name: "CreateAggregation",
    action: "actionCreateAggregation",
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
    action: "actionShareAggregation",
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
    action: "actionShareBuilding",
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
    name: "DrainInbox",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "sharing",
    exposure: "developer",
    hook: "useCheckInbox",
  },
  {
    name: "ReissueGrants",
    action: "actionRebuildSharing",
    effect: "write",
    entity: "sharing",
    exposure: "developer",
    hook: "useReissueGrants",
  },
  {
    name: "AuditGrants",
    action: "actionCheckSharing",
    effect: "read",
    entity: "sharing",
    exposure: "developer",
    hook: "useAuditGrants",
  },
  {
    name: "CheckObservationLinks",
    action: "actionCheckObsLinks",
    effect: "read",
    entity: "observation",
    exposure: "developer",
    hook: "useCheckObservationLinks",
  },
  // ── Organisation ─────────────────────────────────────────────────────────────
  {
    name: "SaveOrganisation",
    action: "actionSaveOrganisation",
    effect: "write",
    entity: "organisation",
    hook: "useSaveOrganisation",
  },
  // ── Agents ─────────────────────────────────────────────────────────────────
  {
    name: "SaveAgent",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "agent",
    hook: "useSaveAgent",
  },
  {
    name: "RemoveAgent",
    action: "", // hook declares no meta.action
    effect: "write",
    entity: "agent",
    hook: "useRemoveAgent",
  },
  {
    name: "SeedDemoAgents",
    action: "actionAddDemoAgents",
    effect: "write",
    entity: "agent",
    exposure: "developer",
    hook: "useSeedDemoAgents",
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
    name: "AddBookmark",
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
    action: "actionAddDemoRooms",
    effect: "write",
    entity: "room",
    exposure: "developer",
    hook: "useSeedDemoRooms",
  },
  // ── Account-scope ────────────────────────────────────────────────────────────
  {
    name: "SeedDemoBuildings",
    action: "actionAddDemoBuildings",
    effect: "write",
    entity: "building",
    exposure: "developer",
    hook: "useSeedDemoBuildings",
  },
  {
    name: "DeclineDemoOffer", // dismiss the fresh-Pod demo-buildings offer (persisted)
    action: "actionDeclineDemos",
    effect: "write",
    entity: "appData",
    hook: "useDeclineDemoOffer",
  },
  {
    name: "DeleteAppData",
    action: "actionDeleteAppData",
    effect: "write",
    entity: "appData",
    exposure: "developer",
    hook: "useRemoveAppData",
  },
  {
    name: "RestoreArchive",
    action: "actionRestoreArchive",
    effect: "write",
    entity: "appData",
    exposure: "developer",
    hook: "useRestoreArchive",
  },
  {
    name: "ExportArchive",
    action: "actionDownloadArchive",
    effect: "read",
    entity: "appData",
    exposure: "developer",
    hook: "useExportArchive",
  },
  // ── Navigation (enter an addressable in-app UI state; no Pod, no hook) ────────
  // The third effect of the trinity; cores are pure route builders (navigate.ts),
  // dispatched by `goTo`. Collection verbs take no params; detail verbs take the
  // resource id/uri/webId.
  { name: "ShowDashboard", action: "", effect: "navigate" },
  { name: "ShowBuildings", action: "", effect: "navigate", entity: "building" },
  { name: "ShowObservations", action: "", effect: "navigate", entity: "observation" },
  { name: "ShowAggregations", action: "", effect: "navigate", entity: "aggregation" },
  { name: "ShowRooms", action: "", effect: "navigate", entity: "room" },
  { name: "ShowAgents", action: "", effect: "navigate", entity: "agent" },
  { name: "ShowSharing", action: "", effect: "navigate", entity: "sharing" },
  { name: "ShowBuilding", action: "", effect: "navigate", entity: "building" },
  { name: "ShowObservation", action: "", effect: "navigate", entity: "observation" },
  { name: "ShowAggregation", action: "", effect: "navigate", entity: "aggregation" },
  { name: "ShowRoom", action: "", effect: "navigate", entity: "room" },
  { name: "ShowAgent", action: "", effect: "navigate", entity: "agent" },
] as const;

/** Resolve the active exposure (default `"standard"`). */
export const intentExposure = (e: IntentEntry): IntentExposure =>
  e.exposure ?? "standard";
