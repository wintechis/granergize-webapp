/**
 * The app's route grammar — the single source for URL paths and the builders that
 * encode ids/IRIs into a detail URL.
 *
 * Phase-0 contract **C1** of the redesign (see `plans/plan-redesign-parallel-execution.md`):
 * frozen here so the page lanes code against it instead of minting inline route
 * strings.
 *
 * Naming follows the locked URI grammar (`plans/plan-app-design-overhaul.md` §4):
 * `/aggregation` is the generic class name; `/buildings` is kept concrete for now
 * (the generic `Place` generalisation is deferred). The analytical collection is
 * `/explore` since Step 3 of the cube-centered plan flipped the centre — the older
 * class name `/observations` and the collection `/aggregations` are both aliases now
 * (see {@link ALIASES}); the `/observation` and `/aggregation` DETAIL routes are
 * unaffected.
 *
 * A resource id is either storage-RELATIVE (own — e.g. `buildings/abc.ttl#it`) or
 * an ABSOLUTE IRI (foreign/shared — e.g. `https://bob.example/…#it`). Detail URLs
 * carry the id as a query param — `?ref=` for relative, `?uri=` for absolute —
 * rather than a path segment, so a raw `/` or `#` in the id can never truncate the
 * path. {@link isAbsoluteIri} (in `services/rdf/building/buildingId.ts`) decides
 * which form applies.
 */
import { isAbsoluteIri } from "./services/rdf/building/buildingId.ts";

/**
 * Finder (collection) routes, in top-nav order (`AppShell.tsx` `NAV`).
 *
 * {@link FINDERS.explore} leads: Step 3 of `plans/plan-cube-centered-ui.md` flipped
 * the app's centre of gravity onto the cube, so `/` lands there and `/explore` is the
 * CANONICAL path of the analytical surface (the page component is still
 * `ObservationsFinder`). The former canonical `/observations` lives on as an alias
 * (see {@link ALIASES}).
 */
export const FINDERS = {
  explore: "/explore",
  buildings: "/buildings",
  agents: "/agents",
  sharing: "/sharing",
  rooms: "/rooms",
} as const;

/**
 * Route **aliases** — former canonical paths that keep working after their surface
 * moved. Both are real served paths (so `index.html`'s base detection must list their
 * segments), both redirect carrying the incoming query string across.
 *
 * - `/observations` was the Explore surface's canonical path until Step 3 of
 *   `plans/plan-cube-centered-ui.md` swapped it with `/explore`
 *   ({@link FINDERS.explore}). It redirects there with the query string carried
 *   VERBATIM, so a deep link keeps its cube coordinate (`?m=`/`?y=`/`?rows=`/`?in=`)
 *   and its projection (`?view=`). The `/observation` DETAIL route is untouched.
 * - `/aggregations` was the Aggregations finder's own top-nav route until Step 2
 *   folded it into Explore as the saved-views projection; it now redirects onto
 *   {@link AGGREGATIONS_VIEW}, MERGING `?view=aggregations` into whatever the link
 *   carried (`guise`, `q`, `offset`, `tiers`, `action`), so every old bookmark, deep
 *   link and palette route lands on the same surface it always did. The
 *   `/aggregation` DETAIL route is untouched.
 */
export const ALIASES = {
  observations: "/observations",
  aggregations: "/aggregations",
} as const;

/**
 * The Explore surface at its **saved views** projection — the folded former
 * Aggregations finder (`?view=aggregations`, the view axis in
 * `services/cube/observationsAxes.ts`). Back-links, the palette's navigation verb and
 * the create-aggregation hand-off target this directly rather than the
 * {@link ALIASES.aggregations} redirect, so they cost no extra hop.
 */
export const AGGREGATIONS_VIEW = `${FINDERS.explore}?view=aggregations`;

/**
 * Detail route *patterns* — bare paths, for the route table. The resource id is no
 * longer a path segment; it's a query param (see {@link detailRoute}), so the route
 * matches the bare path and the page reads `?uri=`/`?ref=`.
 */
export const DETAIL_PATTERNS = {
  building: "/building",
  observation: "/observation",
  aggregation: "/aggregation",
  room: "/room",
  agent: "/agent",
  regional: "/regional",
  dataSources: "/data-sources",
  organisation: "/organisation",
} as const;

/** The home/dashboard route. */
export const HOME = "/";

/**
 * Encode a resource id onto a detail base as a query param. A storage-RELATIVE
 * (own) id rides in `?ref=`; an ABSOLUTE (foreign/shared) IRI rides in `?uri=`
 * ({@link isAbsoluteIri} distinguishes the two shapes). The resolver
 * (`searchParams.get("uri") ?? searchParams.get("ref")`) recovers the id in the
 * SAME form the app stores it, so id-equality matching is unchanged.
 */
export const detailRoute = (base: string, id: string): string =>
  isAbsoluteIri(id)
    ? `${base}?uri=${encodeURIComponent(id)}`
    : `${base}?ref=${encodeURIComponent(id)}`;

/** Builders — encode the id as a `?ref=`/`?uri=` query param. */
export const buildingRoute = (id: string): string =>
  detailRoute(DETAIL_PATTERNS.building, id);
export const observationRoute = (id: string): string =>
  detailRoute(DETAIL_PATTERNS.observation, id);
/** The query param that focuses the observation page on ONE technical system's
 *  own observations (`?unit=<system id>` — the `<#id>` local name of the
 *  `bldg:hasSystem` node whose datasets carry it as feature of interest). */
export const UNIT_PARAM = "unit";
/** The observation page scrolled to one system's per-unit observations. */
export const observationUnitRoute = (id: string, unitId: string): string =>
  `${observationRoute(id)}&${UNIT_PARAM}=${encodeURIComponent(unitId)}`;
export const aggregationRoute = (id: string): string =>
  detailRoute(DETAIL_PATTERNS.aggregation, id);
export const roomRoute = (uri: string): string =>
  detailRoute(DETAIL_PATTERNS.room, uri);
/** The agent (person/organisation) detail page. A WebID is always an absolute IRI,
 *  so an agent always rides in `?uri=`. */
export const agentRoute = (webId: string): string =>
  `${DETAIL_PATTERNS.agent}?uri=${encodeURIComponent(webId)}`;

/** A public open-data regional dataset, keyed by its GENESIS `table` id + region
 *  `ags` (both query params — it has no Pod resource of its own). */
export const regionalRoute = (tableId: string, ags: string): string =>
  `${DETAIL_PATTERNS.regional}?table=${encodeURIComponent(tableId)}&ags=${
    encodeURIComponent(ags)
  }`;

/**
 * The query param a surface reads to **auto-open** a bespoke dialog/editor on
 * arrival (plan-palette §5). When the ⌘K palette routes a *rich* verb
 * (share/edit/create — anything needing a recipient picker or the edit form) it
 * does NOT auto-generate a form; it navigates to the surface that owns that
 * verb's dialog with `?action=<token>` appended, and the surface opens itself.
 *
 * The token vocabulary is small and stable (one per rich verb). It composes with
 * the `?ref=`/`?uri=` id param already on a detail route (`withAction` appends,
 * preserving any existing query string), so e.g. routing Share for an own
 * building yields `/building?ref=…&action=share`. Pure string helpers — Tier-1
 * testable, no React.
 */
export type DialogAction =
  | "add" // Buildings finder → Add building dialog
  | "edit" // Building page → inline master-data editor
  | "share" // Building page → Share dialog
  | "enter-energy" // Observation page → Energy-year dialog (add/edit a year)
  | "create-aggregation" // Explore's saved views → Create aggregation dialog
  | "share-aggregation"; // Aggregation detail → Share aggregation dialog

/** The `?action=` query-param name a surface reads (see {@link DialogAction}). */
export const ACTION_PARAM = "action";

/**
 * Append `?action=<token>` to a route, preserving any existing query string
 * (the `?ref=`/`?uri=` id param a detail route already carries). Used by the
 * palette to route a rich verb to the surface that opens its bespoke dialog.
 */
export const withAction = (route: string, action: DialogAction): string =>
  route.includes("?")
    ? `${route}&${ACTION_PARAM}=${action}`
    : `${route}?${ACTION_PARAM}=${action}`;

/** The bare detail-page paths (the values of {@link DETAIL_PATTERNS}). */
const DETAIL_BASES = new Set<string>(Object.values(DETAIL_PATTERNS));

/**
 * Does this route target a detail page (the surfaces that carry a back affordance,
 * so the only ones worth recording a referrer for)? Compares the bare path before
 * the query string. A finder/collection route returns false — back links *to* a
 * finder don't need a referrer.
 */
export const isDetailRoute = (route: string): boolean =>
  DETAIL_BASES.has(route.split("?")[0]);

/**
 * The **navigation trail** — a breadcrumb of in-app locations (each `pathname+search`,
 * newest last) carried in the browser's History API state (react-router's
 * `location.state`), NOT in the URL. A navigation INTO a detail page pushes the
 * location it was reached *from*, so the page's back affordance returns to the actual
 * referrer (and pressing back repeatedly walks the real chain) — without the old
 * `navigate(-1)` history pop and without polluting the URL.
 *
 * History state is per-entry, session-scoped, and survives a reload; a copied/shared
 * link simply arrives with no trail, so its back falls to the collection finder.
 */
export interface NavState {
  trail?: string[];
}

/** Cap the trail so a long session can't grow history state without bound. */
const TRAIL_MAX = 20;

/**
 * The trail for navigating INTO `target`: the inbound `trail` plus the `current`
 * location (capped to the most recent {@link TRAIL_MAX}). Only detail routes carry a
 * back affordance, so a non-detail target returns the trail unchanged (the caller
 * attaches no state for it).
 */
export const pushTrail = (
  trail: string[],
  current: string,
  target: string,
): string[] =>
  isDetailRoute(target) ? [...trail, current].slice(-TRAIL_MAX) : trail;

/**
 * A detail page's back target: the newest trail entry (the real referrer) when the
 * trail is non-empty, else the page's `fallback` finder (a deep link / fresh tab /
 * shared URL arrives with no trail).
 */
export const backTarget = (
  trail: string[] | undefined,
  fallback: string,
): string => (trail && trail.length > 0 ? trail[trail.length - 1] : fallback);
