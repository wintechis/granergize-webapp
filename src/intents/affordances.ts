/**
 * Affordance facts for the intent catalog — the object-layer companion to
 * {@link INTENTS} (`catalog.ts`).
 *
 * `catalog.ts` is the frozen Phase-0 contract (its shape is drift-guarded against
 * `mutations.ts`), so it stays a lean, import-cheap data table of the *action's
 * nature* (name/effect/entity/hook/exposure). This module adds the two further
 * object-layer facts an affordance surface (the per-object {@link ObjectActions}
 * menu, the ⌘K palette) needs to decide WHICH verbs an object offers a viewer,
 * **without** coupling the canonical catalog to the app's `Building` /
 * `AggregationDefinition` types:
 *
 * - **`applies(object, viewer)`** — the state-filter: does the object's current
 *   state plus the viewer's relationship (own vs shared, snapshot-exists, dev
 *   mode) permit this verb? Pure; these were the per-surface conditionals
 *   (`!building.isShared`, `lastComputedAt != null`), made explicit and reusable.
 *
 * The verb's parameter shape is NOT recorded here — it lives in the modelled RDF
 * schema {@link INTENT_PARAMS} (`params.ts`), bound to the core signature by the
 * compile-time `_paramKeysMatch` witness. The palette's dialog-routing keys off
 * those modelled params (`hasModelledParams` in `commandPalette.ts`), so a verb
 * whose only "param" is a runtime handle (e.g. `DeleteAppData`'s `signal`) is
 * correctly param-less from the user's view.
 *
 * Keyed by the intent's stable `name` (the `IntentEntry.name`); a verb with no
 * affordance entry defaults to "never applies to a per-object menu"
 * (account/room verbs that no menu surfaces yet). `affordances.test.ts` asserts
 * every key here names a real {@link INTENTS} entry — so a rename in the catalog
 * breaks here, not silently.
 *
 * The WHERE an action is offered — the `?action=` dialog routing, the i18n label
 * keys — is the *presentation* layer (the palette / `ObjectActions` / `routes.ts`),
 * NOT here: this module records only the action's own nature.
 */
import type { AggregationDefinition, Building } from "../types.ts";

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
  | Building
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
  /**
   * State-filter: does the object's current state + the viewer's relationship
   * permit this verb? Pure; recomputed per instance + viewer.
   */
  readonly applies: AppliesGuard;
}

// ── Guard helpers ────────────────────────────────────────────────────────────
// The applicability predicates, made explicit from the per-surface conditionals.

function isBuilding(o: IntentObject): o is Building {
  return !!o && typeof o === "object" && "uri" in o && "id" in o &&
    "type" in o;
}

/** Is the candidate an own (not shared-with-me) building? Mirrors `!b.isShared`. */
function isOwnBuilding(o: IntentObject): o is Building {
  return isBuilding(o) && !o.isShared;
}

/** Is the candidate a shared-with-me building? */
function isSharedBuilding(o: IntentObject): o is Building {
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
 * to `{ applies: never }` via {@link affordanceFor} (the room / collection verbs
 * that no per-object menu surfaces yet).
 */
export const INTENT_AFFORDANCES: Record<string, IntentAffordance> = {
  // ── Buildings ──────────────────────────────────────────────────────────────
  CreateBuilding: { applies: always },
  UpdateBuilding: {
    // Editing master data is owner-only (`!building.isShared`, MasterDataSection).
    applies: isOwnBuilding,
  },
  DeleteBuilding: { applies: isOwnBuilding },
  ToggleVisibility: {
    // Only a shared-with-me building can be hidden from the dashboard.
    applies: isSharedBuilding,
  },
  // ── Observations (energy) ────────────────────────────────────────────────────
  SaveObservation: {
    // Entering energy is owner-only (EnergyEntryButton hides for shared).
    applies: isOwnBuilding,
  },
  DeleteObservation: {
    // Own building AND at least one dataset to delete.
    applies: (o) => isOwnBuilding(o) && hasEnergy(o),
  },
  // ── Attachments ──────────────────────────────────────────────────────────────
  UploadAttachments: {
    // Writing files is owner-only (`canWrite = !building.isShared`).
    applies: isOwnBuilding,
  },
  DeleteAttachment: {
    applies: (o) => isOwnBuilding(o) && hasAttachments(o),
  },
  SetEnergyCertificate: {
    applies: (o) => isOwnBuilding(o) && hasAttachments(o),
  },
  // ── Aggregations ─────────────────────────────────────────────────────────────
  CreateAggregation: { applies: always },
  DeleteAggregation: { applies: isAggregation },
  RefreshAggregation: {
    // Refresh only once a first snapshot exists.
    applies: hasSnapshot,
  },
  ShareAggregation: {
    // Can only share a snapshot once one is computed.
    applies: hasSnapshot,
  },
  RevokeAggregationAccess: { applies: isAggregation },
  // ── Sharing ──────────────────────────────────────────────────────────────────
  ShareBuilding: {
    // Sharing is owner-only (SharingSection returns null for shared buildings).
    applies: isOwnBuilding,
  },
  RevokeBuildingAccess: {
    // Revoking is owner-only (you can only revoke a grant you made).
    applies: isOwnBuilding,
  },
  DrainInbox: { applies: devOnly },
  ReissueGrants: { applies: devOnly },
  AuditGrants: { applies: devOnly },
  // ── Rooms ────────────────────────────────────────────────────────────────────
  // No per-object building menu surfaces a room verb (they live in the rooms
  // finder / room page), so `applies: never`.
  CreateRoom: { applies: never },
  EnterRoom: { applies: never },
  ExitRoom: { applies: never },
  DeleteRoom: { applies: never },
  AddBookmark: { applies: never },
  RemoveBookmark: { applies: never },
  SaveRoles: { applies: never },
  SeedDemoRooms: { applies: devOnly },
  // ── Organisation ─────────────────────────────────────────────────────────────
  SaveOrganisation: { applies: always },
  // ── Contacts ─────────────────────────────────────────────────────────────────
  SaveAgent: { applies: always },
  RemoveAgent: { applies: always },
  SeedDemoAgents: { applies: devOnly },
  // ── Account-scope ────────────────────────────────────────────────────────────
  SeedDemoBuildings: { applies: always },
  DeleteAppData: { applies: devOnly },
  RestoreArchive: { applies: devOnly },
  ExportArchive: { applies: devOnly },
};

/** The affordance facts for an intent, defaulting to "never applies". */
export function affordanceFor(name: string): IntentAffordance {
  return INTENT_AFFORDANCES[name] ?? { applies: never };
}
