/**
 * Affordance facts for the intent catalog — the object-layer companion to
 * {@link INTENTS} (`catalog.ts`).
 *
 * `catalog.ts` is the frozen Phase-0 contract (its shape is drift-guarded against
 * `mutations.ts`), so it stays a lean, import-cheap data table of the *action's
 * nature* (name/effect/entity/hook/exposure). This module adds the two further
 * object-layer facts an affordance surface (the per-object {@link ObjectActions}
 * menu, the ⌘K palette) needs to decide WHICH verbs an object offers a viewer,
 * **without** coupling the canonical catalog to the app's `BuildingType` /
 * `AggregationDefinition` types:
 *
 * - **`applies(object, viewer)`** — the state-filter: does the object's current
 *   state plus the viewer's relationship (own vs shared, snapshot-exists, dev
 *   mode) permit this verb? Pure; these were the per-surface conditionals
 *   (`!building.isShared`, `lastComputedAt != null`), made explicit and reusable.
 * - **`params`** — the verb's parameter field names (the hook's `vars` shape).
 *   The palette consults `params.length` to decide whether a verb needs a dialog
 *   (route to its bespoke surface) or can be fired directly.
 *
 * Keyed by the intent's stable `name` (the `IntentEntry.name`); a verb with no
 * affordance entry defaults to "no params, never applies to a per-object menu"
 * (account/room verbs that no menu surfaces yet). `affordances.test.ts` asserts
 * every key here names a real {@link INTENTS} entry — so a rename in the catalog
 * breaks here, not silently.
 *
 * The WHERE an action is offered — the `?action=` dialog routing, the i18n label
 * keys — is the *presentation* layer (the palette / `ObjectActions` / `routes.ts`),
 * NOT here: this module records only the action's own nature.
 */
import type { AggregationDefinition, BuildingType } from "../types.ts";

/**
 * The viewer's relationship to an object plus the developer-mode flag — the
 * context an `applies` guard consults beyond the object's own state.
 */
export interface ViewerContext {
  /** Is developer mode on? Gates `exposure: "developer"` affordances. */
  devMode?: boolean;
}

/**
 * The object an `applies` guard tests. A loose union of the entity shapes the
 * guards inspect (a building, an aggregation definition); collection-wide verbs
 * ignore it. Kept structural so callers can pass the typed instance they hold.
 */
export type IntentObject =
  | BuildingType
  | AggregationDefinition
  | { kind: "Account" }
  | undefined;

/** Predicate: does this verb apply to `object` for `viewer`? */
export type AppliesGuard = (
  object: IntentObject,
  viewer: ViewerContext,
) => boolean;

/** The object-layer affordance facts for one intent. */
export interface IntentAffordance {
  /** The verb's parameter field names — the hook's `vars` shape. */
  readonly params: readonly string[];
  /**
   * State-filter: does the object's current state + the viewer's relationship
   * permit this verb? Pure; recomputed per instance + viewer.
   */
  readonly applies: AppliesGuard;
}

// ── Guard helpers ────────────────────────────────────────────────────────────
// The applicability predicates, made explicit from the per-surface conditionals.

function isBuilding(o: IntentObject): o is BuildingType {
  return !!o && typeof o === "object" && "uri" in o && "id" in o &&
    "type" in o;
}

/** Is the candidate an own (not shared-with-me) building? Mirrors `!b.isShared`. */
function isOwnBuilding(o: IntentObject): o is BuildingType {
  return isBuilding(o) && !o.isShared;
}

/** Is the candidate a shared-with-me building? */
function isSharedBuilding(o: IntentObject): o is BuildingType {
  return isBuilding(o) && o.isShared === true;
}

function isAggregation(o: IntentObject): o is AggregationDefinition {
  return !!o && typeof o === "object" && "aggregationType" in o &&
    "buildingUris" in o;
}

/** Has this building any energy dataset (the deletable / shareable-with-energy unit)? */
function hasEnergy(o: IntentObject): boolean {
  return isBuilding(o) && (o.energyDatasets?.length ?? 0) > 0;
}

/** Does this building carry attachment files? */
function hasAttachments(o: IntentObject): boolean {
  return isBuilding(o) && (o.attachments?.length ?? 0) > 0;
}

/** Has the aggregation a computed snapshot (refresh/share only then)? */
function hasSnapshot(o: IntentObject): boolean {
  return isAggregation(o) && o.lastComputedAt != null;
}

/** Always-applicable (collection-wide / context-free verbs). */
const always: AppliesGuard = () => true;

/** Applicable only with developer mode on (account/dev-only verbs). */
const devOnly: AppliesGuard = (_o, v) => v.devMode === true;

/** Never applies to a per-object affordance surface (no menu surfaces it yet). */
const never: AppliesGuard = () => false;

/**
 * Affordance facts keyed by the catalog intent `name`. Verbs absent here default
 * to `{ params: [], applies: never }` via {@link affordanceFor} (the room /
 * collection verbs that no per-object menu surfaces yet).
 */
export const INTENT_AFFORDANCES: Record<string, IntentAffordance> = {
  // ── Buildings ──────────────────────────────────────────────────────────────
  AddBuilding: {
    params: ["buildings", "lastgangReadings", "signal", "onProgress"],
    applies: always,
  },
  UpdateBuilding: {
    // Editing master data is owner-only (`!building.isShared`, MasterDataSection).
    params: ["fileUri", "subjectUri", "fields"],
    applies: isOwnBuilding,
  },
  DeleteBuilding: {
    params: ["building"],
    applies: isOwnBuilding,
  },
  ToggleVisibility: {
    // Only a shared-with-me building can be hidden from the dashboard.
    params: ["buildingUri"],
    applies: isSharedBuilding,
  },
  // ── Observations (energy) ────────────────────────────────────────────────────
  SaveObservation: {
    // Entering energy is owner-only (EnergyEntryButton hides for shared).
    params: ["fileUri", "subjectUri", "dataset"],
    applies: isOwnBuilding,
  },
  DeleteObservation: {
    // Own building AND at least one dataset to delete.
    params: ["fileUri", "subjectUri", "dataset"],
    applies: (o) => isOwnBuilding(o) && hasEnergy(o),
  },
  // ── Attachments ──────────────────────────────────────────────────────────────
  UploadAttachments: {
    // Writing files is owner-only (`canWrite = !building.isShared`).
    params: ["fileUri", "subjectUri", "files", "onUploaded"],
    applies: isOwnBuilding,
  },
  DeleteAttachment: {
    params: ["fileUri", "subjectUri", "url"],
    applies: (o) => isOwnBuilding(o) && hasAttachments(o),
  },
  SetEnergyCertificate: {
    params: ["fileUri", "subjectUri", "url"],
    applies: (o) => isOwnBuilding(o) && hasAttachments(o),
  },
  // ── Aggregations ─────────────────────────────────────────────────────────────
  CreateAggregation: {
    params: [
      "name",
      "buildingUris",
      "aggregationType",
      "metrics",
      "period",
      "benchmark",
    ],
    applies: always,
  },
  DeleteAggregation: {
    params: ["aggregationId"],
    applies: isAggregation,
  },
  RefreshAggregation: {
    // Refresh only once a first snapshot exists.
    params: ["aggregationId"],
    applies: hasSnapshot,
  },
  ShareAggregation: {
    // Can only share a snapshot once one is computed.
    params: ["snapshotUri", "recipients"],
    applies: hasSnapshot,
  },
  RevokeAggregationAccess: {
    params: ["snapshotUri", "webId"],
    applies: isAggregation,
  },
  // ── Sharing ──────────────────────────────────────────────────────────────────
  ShareBuilding: {
    // Sharing is owner-only (SharingSection returns null for shared buildings).
    params: ["buildingUri", "recipients", "includeEnergyData", "years"],
    applies: isOwnBuilding,
  },
  RevokeBuildingAccess: {
    // Revoking is owner-only (you can only revoke a grant you made).
    params: ["buildingUri", "webId"],
    applies: isOwnBuilding,
  },
  CheckInbox: { params: [], applies: devOnly },
  ReissueGrants: { params: [], applies: devOnly },
  AuditGrants: { params: [], applies: devOnly },
  // ── Organisation ─────────────────────────────────────────────────────────────
  SaveOrganisation: { params: ["org", "logo"], applies: always },
  // ── Contacts ─────────────────────────────────────────────────────────────────
  SaveContact: { params: ["contact"], applies: always },
  RemoveContact: { params: ["webId"], applies: always },
  SeedDemoContacts: { params: [], applies: devOnly },
  // ── Account-scope ────────────────────────────────────────────────────────────
  SeedDemoBuildings: { params: [], applies: always },
  RemoveAppData: { params: ["signal"], applies: devOnly },
  RestoreArchive: { params: ["bytes"], applies: devOnly },
  ExportArchive: { params: [], applies: devOnly },
};

/** The affordance facts for an intent, defaulting to "no params, never applies". */
export function affordanceFor(name: string): IntentAffordance {
  return INTENT_AFFORDANCES[name] ?? { params: [], applies: never };
}
