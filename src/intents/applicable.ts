/**
 * The state-filtered affordance set — composes the canonical catalog
 * ({@link INTENTS}, `catalog.ts`) with its object-layer affordance companion
 * ({@link affordanceFor}, `affordances.ts`).
 *
 * This is the one resolver both affordance surfaces read (the per-object
 * {@link ObjectActions} menu and the ⌘K palette): which verbs an object offers a
 * viewer, after both the developer-mode exposure gate (from the catalog) and the
 * applicability guard (from the affordances). So the palette and the menus can
 * never offer a different verb set for the same object. React-free → Tier-1
 * testable.
 */
import { type IntentEntry, intentExposure, INTENTS } from "./catalog.ts";
import {
  affordanceFor,
  type IntentObject,
  type ViewerContext,
} from "./affordances.ts";

export type { IntentObject, ViewerContext } from "./affordances.ts";
export type { IntentEntry } from "./catalog.ts";

/** Look an intent up by its stable `name`. */
export function findIntent(name: string): IntentEntry | undefined {
  return INTENTS.find((e) => e.name === name);
}

/** Does this verb apply to `object` for `viewer` (its affordance guard)? */
export function intentApplies(
  entry: IntentEntry,
  object: IntentObject,
  viewer: ViewerContext,
): boolean {
  return affordanceFor(entry.name).applies(object, viewer);
}

/**
 * The verbs an object offers a viewer, in the catalog's source order, after both
 * the developer-mode exposure gate and the applicability guard.
 */
export function applicableIntents(
  object: IntentObject,
  viewer: ViewerContext,
): IntentEntry[] {
  return INTENTS.filter((e) => {
    if (intentExposure(e) === "developer" && !viewer.devMode) return false;
    return intentApplies(e, object, viewer);
  });
}
