/**
 * The app's route grammar — the single source for URL paths and the builders that
 * encode ids/IRIs into a path segment.
 *
 * Phase-0 contract **C1** of the redesign (see `plans/plan-redesign-parallel-execution.md`):
 * frozen here so the page lanes code against it instead of minting inline route
 * strings. Mostly *target* grammar — some routes are wired by later lanes
 * (the finder pages, the `BrowserRouter` switch in L-routing); this module is
 * additive and behaviour-preserving until they adopt it.
 *
 * Naming follows the locked URI grammar (`plans/plan-app-design-overhaul.md` §4):
 * `/observations` + `/aggregations` are the generic class names; `/buildings` is
 * kept concrete for now (the generic `Place` generalisation is deferred). Ids carry
 * `/` and `#`, so every builder `encodeURIComponent`s its argument (see
 * `services/rdf/building/buildingId.ts`).
 */

/** Finder (collection) routes. */
export const FINDERS = {
  buildings: "/buildings",
  observations: "/observations",
  aggregations: "/aggregations",
  rooms: "/rooms",
  contacts: "/contacts",
  sharing: "/sharing",
} as const;

/** Detail route *patterns* (react-router `:param` form), for the route table. */
export const DETAIL_PATTERNS = {
  building: "/building/:id",
  observation: "/observation/:id",
  aggregation: "/aggregation/:id",
  room: "/room/:id",
  contact: "/contact/:webId",
} as const;

/** The home/dashboard route. */
export const HOME = "/";

/** Builders — encode the param into a single path segment. */
export const buildingRoute = (id: string): string =>
  `/building/${encodeURIComponent(id)}`;
export const observationRoute = (id: string): string =>
  `/observation/${encodeURIComponent(id)}`;
export const aggregationRoute = (id: string): string =>
  `/aggregation/${encodeURIComponent(id)}`;
export const roomRoute = (uri: string): string =>
  `/room/${encodeURIComponent(uri)}`;
export const contactRoute = (webId: string): string =>
  `/contact/${encodeURIComponent(webId)}`;
