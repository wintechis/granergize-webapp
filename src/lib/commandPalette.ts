/**
 * The command-palette command list — pure assembly (plan-palette §4).
 *
 * The ⌘K palette is the intent catalog made *callable for humans*, decoupled from
 * any one screen. This module is its React-free core: given the **focused** object
 * (or none), the viewer context, the navigation targets, the per-intent handlers a
 * surface registered, and the i18n `t()`, it produces the ordered, filtered,
 * labelled {@link PaletteCommand} list the palette renders — reading the **same**
 * {@link applicableIntents} resolver the per-object {@link ObjectActions} menus do
 * (§3), so the palette and the menus can never offer a different verb set for the
 * same object.
 *
 * It reads the canonical object layer (`intents/catalog.ts` + `affordances.ts` via
 * `applicable.ts`) plus the presentation layer (`labels.ts`); it no longer carries
 * its own registry.
 *
 * Two command families, in this order:
 * - **navigation** — global "go to {finder}" verbs, always present (the palette's
 *   fallback when nothing is focused, and a quick-switch otherwise);
 * - **intent** — the focused object's applicable verbs (affordance guard + dev-mode
 *   exposure). An intent's *invocation* splits by whether it routes to a bespoke
 *   dialog (`PaletteCommand.routesToDialog`): a **direct** verb (hide/delete/refresh)
 *   invokes through the surface's handler; a **dialog-routed** verb
 *   (share/edit/create/enter-energy) routes to its existing bespoke dialog rather
 *   than auto-generating a form (§5 is the later polish).
 *
 * Kept pure so it is Tier-1 testable: the React component (`CommandPalette.tsx`)
 * layers on `useT()` / `useDevMode()` / `useNavigate()` and the focus context.
 */
import { type IntentEntry } from "../intents/catalog.ts";
import {
  applicableIntents,
  type IntentObject,
  type ViewerContext,
} from "../intents/applicable.ts";
import { INTENT_PARAMS } from "../intents/params.ts";
import { intentLabelKey } from "../intents/labels.ts";
import { type MessageId } from "./messages.ts";
import type { DialogAction } from "../routes.ts";
import type { TFn } from "../context/I18nProvider.tsx";

export type { IntentObject, ViewerContext } from "../intents/applicable.ts";
export type { IntentEntry } from "../intents/catalog.ts";

/** A global "go to {finder}" target the palette always offers. */
export interface NavTarget {
  /** The route path to navigate to (`FINDERS.*`). */
  path: string;
  /** The i18n label key for the destination (`nav*`). */
  labelKey: MessageId;
}

/** One renderable palette command — a navigation jump or an object verb. */
export interface PaletteCommand {
  /**
   * Stable React/handler key: the route path (navigation) or the intent's `name`
   * (intent). Unique within a command list.
   */
  key: string;
  /** Command family — drives both grouping and how it is invoked. */
  family: "navigation" | "intent";
  /** The localised label shown (and matched against the filter). */
  label: string;
  /**
   * Navigation only: the route path to push. (Intents carry no path; they invoke
   * through their handler / route to their dialog.)
   */
  path?: string;
  /** Intent only: the catalog entry this command was resolved from. */
  entry?: IntentEntry;
  /**
   * Intent only: does this verb route to its bespoke dialog (rather than invoke
   * directly)? `true` when it both declares modelled params AND has a bespoke
   * dialog surface (share/edit/create/enter-energy); `false` for the direct verbs
   * (hide/delete/refresh) the palette can fire straight away.
   */
  routesToDialog?: boolean;
}

/**
 * For a dialog-routed (rich) verb, the {@link DialogAction} token the palette
 * appends to the surface's route (`?action=…`) so the destination opens its
 * bespoke dialog/editor on arrival. Maps the catalog intent's stable `name` → a
 * token; `null` for a verb whose surface has no auto-open hook (it routes to the
 * page and the user opens the dialog there — the un-wired-yet fallback).
 *
 * Kept here (not in the catalog) because it is a *surface-routing* concern, not an
 * intent fact: the same verb could open in different places. Pure → Tier-1
 * testable. Only the verbs whose surfaces are actually wired to read `?action=`
 * (plan-palette §5) get a token.
 */
export function intentDialogAction(entry: IntentEntry): DialogAction | null {
  switch (entry.name) {
    case "AddBuilding":
      return "add";
    case "UpdateBuilding":
      return "edit";
    case "ShareBuilding":
      return "share";
    case "SaveObservation":
      return "enter-energy";
    case "CreateAggregation":
      return "create-aggregation";
    case "ShareAggregation":
      return "share-aggregation";
    default:
      return null;
  }
}

/**
 * The set of intent names that own a bespoke dialog/confirm surface (so a palette
 * routes to it rather than firing the verb directly). This is the surface-routing
 * companion to {@link intentDialogAction}: every name with a `?action=` token is
 * here, plus the verbs whose surface has no auto-open token but still routes (the
 * Delete confirms, reached on the destination page).
 */
const DIALOG_SURFACE = new Set<string>([
  "AddBuilding",
  "UpdateBuilding",
  "ShareBuilding",
  "SaveObservation",
  "DeleteObservation",
  "CreateAggregation",
  "ShareAggregation",
  "DeleteBuilding",
]);

/**
 * Does this verb have ≥1 *modelled* RDF param ({@link INTENT_PARAMS})? The basis
 * for the dialog-routing decision: it counts only the params the user supplies,
 * NOT the runtime-only handles (`signal`/`onProgress`/`onUploaded`) the schema
 * deliberately omits — so a verb whose sole "param" is such a handle (e.g.
 * `RemoveAppData`'s `signal`) is correctly param-less and is fired directly.
 */
function hasModelledParams(name: string): boolean {
  const schema = (INTENT_PARAMS as Record<string, object>)[name];
  return schema != null && Object.keys(schema).length > 0;
}

/**
 * Does a verb need parameter capture (→ route to its dialog) or can the palette
 * invoke it directly? A verb routes to a dialog when it both records a bespoke
 * surface to open AND declares ≥1 modelled param. A param-less verb, or one with
 * no surface, is invoked directly through the surface's handler.
 */
export function intentRoutesToDialog(entry: IntentEntry): boolean {
  return DIALOG_SURFACE.has(entry.name) && hasModelledParams(entry.name);
}

/** Filter a command list by a case-insensitive substring of the label. */
export function filterCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

/**
 * Assemble the ordered command list for the palette. Navigation commands come
 * first (always available), then the focused object's applicable intents (in the
 * catalog's source order). An intent is included only if a handler was supplied
 * for it OR it routes to a dialog (a dialog-routed verb needs no direct handler —
 * the component opens the surface). React-free for Tier-1 testing.
 */
export function buildCommandList(opts: {
  object: IntentObject;
  viewer: ViewerContext;
  navTargets: NavTarget[];
  /** Per-intent direct handlers, keyed by intent `name`. */
  handlers: Record<string, () => void>;
  t: TFn;
}): PaletteCommand[] {
  const { object, viewer, navTargets, handlers, t } = opts;
  const commands: PaletteCommand[] = [];

  for (const target of navTargets) {
    commands.push({
      key: target.path,
      family: "navigation",
      label: t(target.labelKey),
      path: target.path,
    });
  }

  for (const entry of applicableIntents(object, viewer)) {
    const routesToDialog = intentRoutesToDialog(entry);
    // A direct (param-less) verb needs a handler; a dialog-routed verb is opened
    // by the component, so it may appear without one.
    if (!routesToDialog && !handlers[entry.name]) continue;
    // Only surface a verb that has an i18n label key (i.e. one a menu surfaces);
    // verbs with no key are not yet user-facing and are skipped here.
    const key = intentLabelKey(entry.name);
    if (!key) continue;
    commands.push({
      key: entry.name,
      family: "intent",
      label: t(key as MessageId),
      entry,
      routesToDialog,
    });
  }

  return commands;
}
