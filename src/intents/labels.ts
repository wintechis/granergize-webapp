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
} as const satisfies Record<string, string>;

/** Stable names of the intents an action menu can surface (those with a label key). */
export type SurfacedIntentName = keyof typeof INTENT_LABEL_KEY;

/** The i18n label key for an intent, or `null` if it has no action-menu surface yet. */
export function intentLabelKey(name: string): string | null {
  return name in INTENT_LABEL_KEY
    ? INTENT_LABEL_KEY[name as SurfacedIntentName]
    : null;
}
