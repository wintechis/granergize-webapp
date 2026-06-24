/**
 * Presentation: the i18n label key for each intent whose verb is surfaced as a
 * per-object action control (the {@link ObjectActions} menu, the ⌘K palette).
 *
 * Maps the catalog intent's stable `name` → a `messages.ts` id, so the affordance
 * surfaces render their labels through the app's i18n mechanism (`useT()`), not
 * the catalog's machine `action` key. A verb with no entry here is one no per-object
 * menu surfaces yet (account/dev/room verbs) — the palette falls back to its
 * catalog `name`. Kept pure (a plain id string, not the resolved text) so it is
 * Tier-1 testable and React-free.
 *
 * This is the presentation layer, NOT the object-layer catalog: WHERE/HOW a verb's
 * label reads is an affordance concern, not part of the action's identity.
 */
export const INTENT_LABEL_KEY = {
  AddBuilding: "intentAddBuilding",
  UpdateBuilding: "intentUpdateBuilding",
  CreateAggregation: "intentCreateAggregation",
  DeleteBuilding: "intentDeleteBuilding",
  ShareBuilding: "intentShareBuilding",
  ToggleVisibility: "intentToggleBuildingVisibility",
  DeleteAggregation: "intentDeleteAggregation",
  RefreshAggregation: "intentRefreshAggregation",
  ShareAggregation: "intentShareAggregation",
  SaveObservation: "intentSaveEnergyYear",
  DeleteObservation: "intentDeleteEnergyYear",
  // Form-eligible verbs the palette's schema-driven form surfaces (no per-object
  // menu surfaces these yet — they reach the user only through the ⌘K form).
  RevokeBuildingAccess: "intentRevokeBuildingAccess",
  RevokeAggregationAccess: "intentRevokeAggregationAccess",
  RemoveAgent: "intentRemoveAgent",
  EnterRoom: "intentEnterRoom",
  ExitRoom: "intentExitRoom",
  DeleteRoom: "intentDeleteRoom",
  AddRoom: "intentAddRoom",
  RemoveBookmark: "intentRemoveBookmark",
  // Paramless write verbs the palette fires directly (no form, no dialog). Each
  // reuses the verb's existing user-facing wording: CreateRoom → the Rooms-finder
  // host button; the dev seeders / inbox-check / sharing-rebuild → their
  // account-menu / share-tab labels.
  CreateRoom: "roomHostBtn",
  SeedDemoBuildings: "menuAddBuildings",
  SeedDemoAgents: "intentSeedDemoAgents",
  SeedDemoRooms: "intentSeedDemoRooms",
  CheckInbox: "shareCheckForNew",
  ReissueGrants: "menuRebuildSharing",
} as const satisfies Record<string, string>;

/** Stable names of the intents an action menu can surface (those with a label key). */
export type SurfacedIntentName = keyof typeof INTENT_LABEL_KEY;

/** The i18n label key for an intent, or `null` if it has no action-menu surface yet. */
export function intentLabelKey(name: string): string | null {
  return name in INTENT_LABEL_KEY
    ? INTENT_LABEL_KEY[name as SurfacedIntentName]
    : null;
}

/**
 * Per-param field labels for the schema-driven palette form (the `IntentParamForm`
 * field captions). Keyed by the `INTENT_PARAMS` param NAME — every v1 form-eligible
 * verb's params resolve here unambiguously by name (a `buildingUri` is always a
 * building, a `webId` always a person), so a flat by-name map suffices and no
 * `(intent, param)` disambiguation is needed. Reuses the existing `racLabel`
 * (recipients) and `lblYear`-family ids where they fit. Pure (a plain id), React-
 * free → Tier-1 testable, same stance as {@link INTENT_LABEL_KEY}.
 */
export const PARAM_LABEL: Record<string, string> = {
  buildingUri: "paramBuilding",
  recipients: "racLabel",
  includeEnergyData: "paramIncludeEnergyData",
  years: "paramYears",
  attachmentUris: "paramAttachments",
  snapshotUri: "paramAggregation",
  aggregationId: "paramAggregation",
  webId: "paramWebId",
  roomUri: "paramRoom",
  input: "paramRoomInput",
};

/** The i18n label key for a form param, or `null` if it has none. */
export function paramLabelKey(paramName: string): string | null {
  return PARAM_LABEL[paramName] ?? null;
}
