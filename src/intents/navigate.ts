/**
 * The **navigate** arm of the intent trinity (`plan-intent-core.md` §7) — the third
 * dispatch beside `invoke` (write) and `query` (read). A navigate intent enters an
 * addressable in-app UI state ("show building X", "go to the benchmarks"); it
 * touches **no Pod**, so a navigate core is `(params) → Route` with **no
 * `PodGateway`** — it can't share the `(name, params, gateway)` signature, hence its
 * own `goTo` dispatcher.
 *
 * Cores are pure route builders over `routes.ts` (the single source of route
 * strings). The caller pushes the returned route (`navigate(route)` in the app,
 * `page.goto` in a test). The palette's own human-facing nav commands
 * (`lib/commandPalette.ts`) still exist as a presentation projection; THIS layer is
 * what the launcher / LLM / eval target, so navigation is reachable headlessly.
 */
import {
  AGGREGATIONS_VIEW,
  aggregationRoute,
  agentRoute,
  buildingRoute,
  FINDERS,
  HOME,
  observationRoute,
  roomRoute,
} from "../routes.ts";

/** Navigate cores keyed by the catalog `name`: pure `(params) → route string`. The
 * collection verbs take no params; the detail verbs take the resource id/uri/webId
 * (the route builders encode `?ref=`/`?uri=`). */
export const NAVIGATE_CORES = {
  // ── Collections (no params; goTo may pass an arg — harmlessly ignored) ───────
  ShowDashboard: () => HOME,
  ShowBuildings: () => FINDERS.buildings,
  ShowObservations: () => FINDERS.explore,
  ShowAggregations: () => AGGREGATIONS_VIEW,
  ShowRooms: () => FINDERS.rooms,
  ShowAgents: () => FINDERS.agents,
  ShowSharing: () => FINDERS.sharing,
  // ── Detail (one id/uri/webId) ────────────────────────────────────────────────
  ShowBuilding: (p: { id: string }) => buildingRoute(p.id),
  ShowObservation: (p: { id: string }) => observationRoute(p.id),
  ShowAggregation: (p: { id: string }) => aggregationRoute(p.id),
  ShowRoom: (p: { uri: string }) => roomRoute(p.uri),
  ShowAgent: (p: { webId: string }) => agentRoute(p.webId),
} as const;

/** A catalog name with a navigate core. */
export type NavigateIntentName = keyof typeof NAVIGATE_CORES;

/** Param-name hint per detail navigate verb, for the LLM prompt (collection verbs
 * take none). Kept here, not in `INTENT_PARAMS` — navigate cores don't take a
 * gateway, so they're outside the write/read param-witness machinery. */
export const NAVIGATE_PARAM_HINTS: Partial<Record<NavigateIntentName, string>> = {
  ShowBuilding: "id (the building's id, OR its name / address — resolved to the building)",
  ShowObservation: "id",
  ShowAggregation: "id",
  ShowRoom: "uri",
  ShowAgent: "webId",
};

/** Thrown by {@link goTo} for a name with no navigate core. */
export class NotNavigableError extends Error {
  constructor(name: string) {
    super(`Intent "${name}" has no navigate core`);
    this.name = "NotNavigableError";
  }
}

/**
 * Dispatch a navigate intent by name → the route to push. Gateway-less and
 * synchronous (no Pod). Throws {@link NotNavigableError} for an unknown name.
 */
export function goTo(name: string, params: Record<string, unknown> = {}): string {
  const cores = NAVIGATE_CORES as unknown as Record<
    string,
    ((p: Record<string, unknown>) => string) | undefined
  >;
  const core = cores[name];
  if (!core) throw new NotNavigableError(name);
  return core(params);
}
