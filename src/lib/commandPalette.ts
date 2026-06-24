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
import { intentExposure, type IntentEntry, INTENTS } from "../intents/catalog.ts";
import {
  applicableIntents,
  type IntentObject,
  type ViewerContext,
} from "../intents/applicable.ts";
import { INTENT_PARAMS } from "../intents/params.ts";
import { intentLabelKey } from "../intents/labels.ts";
import { isFormEligible } from "./paramForm.ts";
import { type MessageId } from "./messages.ts";
import { type DialogAction, withAction } from "../routes.ts";
import { goTo } from "../intents/navigate.ts";
import { buildingDisplayName, buildingSearchText } from "./buildingDisplay.ts";
import type { BuildingType } from "../types.ts";
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
  /** The localised label shown. */
  label: string;
  /**
   * Text the filter matches against INSTEAD of the label (defaults to the label).
   * Lets a building-jump be found by its address / company / code while still
   * displaying its short name.
   */
  searchText?: string;
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
  /**
   * Intent only: does selecting this verb open the **schema-driven param form**
   * (`IntentParamForm`) as the palette's second step? `true` for a form-eligible
   * verb ({@link isFormEligible}) — the form collects every param and `invoke`s with
   * NO focused object. Takes precedence over `routesToDialog` when both could apply.
   */
  routesToForm?: boolean;
  /**
   * Intent only: is this a **param-less write verb** the palette fires straight
   * away ({@link isDirectInvokeEligible}) — no form, no dialog, no focused object?
   * `true` for the global collection-wide verbs (`CreateRoom`, the dev seeders,
   * `CheckInbox`, `ReissueGrants`); the component `invoke`s it with `{}` on select.
   */
  routesToDirect?: boolean;
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
 * Param-less write verbs the palette must NOT fire as a one-click direct invoke,
 * even though they qualify by shape. {@link RemoveAppData} is destructive and
 * owns a bespoke confirm — it is not a ⌘K one-shot.
 */
export const DIRECT_INVOKE_EXCLUDED: ReadonlySet<string> = new Set<string>([
  "RemoveAppData",
]);

/**
 * Is this a **param-less write verb** the palette can fire straight away (no form,
 * no dialog, no focused object)? True iff it is a `write` effect, has NO modelled
 * params, and is not in {@link DIRECT_INVOKE_EXCLUDED}. Param-less *reads*
 * (`ExportArchive`/`AuditGrants`) return a value needing handling and are excluded
 * by the `write`-effect requirement. A pure predicate over the catalog entry.
 *
 * The set this yields: `CreateRoom` (standard), and — developer-gated —
 * `SeedDemoBuildings`, `SeedDemoContacts`, `SeedDemoRooms`, `CheckInbox`,
 * `ReissueGrants`.
 */
export function isDirectInvokeEligible(entry: IntentEntry): boolean {
  return entry.effect === "write" &&
    !hasModelledParams(entry.name) &&
    !DIRECT_INVOKE_EXCLUDED.has(entry.name);
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

/**
 * "Jump to a building" navigation commands — the user's buildings as direct nav
 * targets, labelled by {@link buildingDisplayName} and routed by {@link buildingRoute}
 * (which encodes `?ref=` for an own id / `?uri=` for a shared IRI, so both kinds
 * jump correctly). The palette surfaces these only while filtering (a quick-switcher),
 * so they never flood the default command view. Pure → Tier-1 testable.
 */
export function buildingNavCommands(
  buildings: readonly BuildingType[],
): PaletteCommand[] {
  return buildings.map((b) => {
    // Route through the catalog navigate core (ShowBuilding) — same string as
    // buildingRoute(b.id), but via the trinity's navigate arm (one source).
    const route = goTo("ShowBuilding", { id: b.id });
    return {
      key: route,
      family: "navigation" as const,
      label: buildingDisplayName(b),
      searchText: buildingSearchText(b),
      path: route,
    };
  });
}

/**
 * "Add observation to ⟨building⟩" commands — one per OWNED building, routing to its
 * observation page with the `enter-energy` action so `EnergyYearEditor` auto-opens.
 * Energy entry is owner-only, so shared-with-me buildings are excluded. Like
 * {@link buildingNavCommands}, surfaced only while filtering (a quick action), so it
 * never floods the default view. `label` formats the localised "Add observation to
 * {name}" string (kept out of this pure module). Pure → Tier-1 testable.
 */
export function buildingObservationCommands(
  buildings: readonly BuildingType[],
  label: (name: string) => string,
): PaletteCommand[] {
  return buildings
    .filter((b) => !b.isShared)
    .map((b) => {
      const text = label(buildingDisplayName(b));
      const path = withAction(
        goTo("ShowObservation", { id: b.id }),
        "enter-energy",
      );
      return {
        key: path,
        family: "navigation" as const,
        label: text,
        // Findable by the action words ("add observation") AND the building's
        // name / address / company / code.
        searchText: `${text} ${buildingSearchText(b)}`,
        path,
      };
    });
}

/**
 * Resolve a free-text reference to a building — for the LLM launcher's
 * `ShowBuilding` navigate, where the model passes the building's *name/address* (it
 * has no id list) and the palette maps it to the real id before `goTo`. An exact id
 * match wins; otherwise the first building whose {@link buildingSearchText}
 * (name / address / company / code) contains the query. `undefined` if none match.
 * Pure → Tier-1 testable.
 */
export function resolveBuildingByQuery(
  buildings: readonly BuildingType[],
  query: string,
): BuildingType | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const byId = buildings.find((b) => b.id === query);
  if (byId) return byId;
  return buildings.find((b) => buildingSearchText(b).toLowerCase().includes(q));
}

/** Filter a command list by a case-insensitive substring of the label. */
export function filterCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => (c.searchText ?? c.label).toLowerCase().includes(q));
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

  const seen = new Set<string>();
  for (const entry of applicableIntents(object, viewer)) {
    const routesToForm = isFormEligible(entry.name);
    const routesToDialog = !routesToForm && intentRoutesToDialog(entry);
    // A form-eligible verb is opened by the palette's form step (no handler
    // needed); a dialog-routed verb is opened by the component; a direct
    // (param-less) verb needs a handler to fire.
    if (!routesToForm && !routesToDialog && !handlers[entry.name]) continue;
    // Only surface a verb that has an i18n label key (i.e. one a menu surfaces);
    // verbs with no key are not yet user-facing and are skipped here.
    const key = intentLabelKey(entry.name);
    if (!key) continue;
    seen.add(entry.name);
    commands.push({
      key: entry.name,
      family: "intent",
      label: t(key as MessageId),
      entry,
      routesToDialog,
      routesToForm,
    });
  }

  // Form-eligible verbs reach the palette WITHOUT a focused object — the entity
  // pickers in the form ARE the object selection (the real fix for the placement
  // gap). Surface every form-eligible verb (exposure-gated) not already offered
  // for the focused object, so e.g. "Share building" is invocable from anywhere.
  for (const entry of INTENTS) {
    if (seen.has(entry.name)) continue;
    if (!isFormEligible(entry.name)) continue;
    if (intentExposure(entry) === "developer" && !viewer.devMode) continue;
    const key = intentLabelKey(entry.name);
    if (!key) continue;
    seen.add(entry.name);
    commands.push({
      key: entry.name,
      family: "intent",
      label: t(key as MessageId),
      entry,
      routesToForm: true,
    });
  }

  // Param-less write verbs reach the palette globally too — there is nothing to
  // collect, so the component fires them directly with `{}` (no form, no dialog).
  // Exposure-gated (dev verbs only in dev mode) and deduped against everything
  // already surfaced.
  for (const entry of INTENTS) {
    if (seen.has(entry.name)) continue;
    if (!isDirectInvokeEligible(entry)) continue;
    if (intentExposure(entry) === "developer" && !viewer.devMode) continue;
    const key = intentLabelKey(entry.name);
    if (!key) continue;
    seen.add(entry.name);
    commands.push({
      key: entry.name,
      family: "intent",
      label: t(key as MessageId),
      entry,
      routesToDirect: true,
    });
  }

  return commands;
}
