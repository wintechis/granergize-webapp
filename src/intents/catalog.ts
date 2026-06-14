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
 * code hooks still say `energy`/`view` until the L-observations rename.
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
 * Seed entries — faithful, not yet exhaustive (L-intent-registry completes the set
 * and wires the hooks to derive from it). Chosen to exercise every field:
 * write/read effects, silent vs. toasted, standard vs. developer.
 */
export const INTENTS: readonly IntentEntry[] = [
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
    name: "ShareBuilding",
    action: "share the building",
    effect: "write",
    entity: "building",
    silentError: true,
    hook: "useShareBuilding",
  },
  {
    name: "SaveObservation", // hook: energy year (rename lands in L-observations)
    action: "save energy data",
    effect: "write",
    entity: "observation",
    hook: "useWriteEnergyYear",
  },
  {
    name: "CreateAggregation", // hook: view (rename lands in L-observations)
    action: "create the view",
    effect: "write",
    entity: "aggregation",
    hook: "useCreateView",
  },
  {
    name: "ExportArchive",
    action: "download the archive",
    effect: "read",
    entity: "appData",
    exposure: "developer",
    hook: "useExportArchive",
  },
  {
    name: "AuditGrants",
    action: "check sharing consistency",
    effect: "read",
    entity: "sharing",
    exposure: "developer",
    hook: "useAuditGrants",
  },
  {
    name: "RemoveAppData",
    action: "remove app data",
    effect: "write",
    entity: "appData",
    exposure: "developer",
    hook: "useRemoveAppData",
  },
] as const;

/** Resolve the active exposure (default `"standard"`). */
export const intentExposure = (e: IntentEntry): IntentExposure =>
  e.exposure ?? "standard";
