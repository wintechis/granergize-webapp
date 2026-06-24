/**
 * The app's route grammar — the single source for URL paths and the builders that
 * encode ids/IRIs into a detail URL.
 *
 * Phase-0 contract **C1** of the redesign (see `plans/plan-redesign-parallel-execution.md`):
 * frozen here so the page lanes code against it instead of minting inline route
 * strings.
 *
 * Naming follows the locked URI grammar (`plans/plan-app-design-overhaul.md` §4):
 * `/observations` + `/aggregations` are the generic class names; `/buildings` is
 * kept concrete for now (the generic `Place` generalisation is deferred).
 *
 * A resource id is either storage-RELATIVE (own — e.g. `buildings/abc.ttl#it`) or
 * an ABSOLUTE IRI (foreign/shared — e.g. `https://bob.example/…#it`). Detail URLs
 * carry the id as a query param — `?ref=` for relative, `?uri=` for absolute —
 * rather than a path segment, so a raw `/` or `#` in the id can never truncate the
 * path. {@link isAbsoluteIri} (in `services/rdf/building/buildingId.ts`) decides
 * which form applies.
 */
import { isAbsoluteIri } from "./services/rdf/building/buildingId.ts";

/** Finder (collection) routes. */
export const FINDERS = {
  buildings: "/buildings",
  observations: "/observations",
  aggregations: "/aggregations",
  rooms: "/rooms",
  contacts: "/contacts",
  sharing: "/sharing",
} as const;

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
  contact: "/contact",
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
export const aggregationRoute = (id: string): string =>
  detailRoute(DETAIL_PATTERNS.aggregation, id);
export const roomRoute = (uri: string): string =>
  detailRoute(DETAIL_PATTERNS.room, uri);
/** A WebID is always an absolute IRI, so a contact always rides in `?uri=`. */
export const contactRoute = (webId: string): string =>
  `${DETAIL_PATTERNS.contact}?uri=${encodeURIComponent(webId)}`;

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
  | "create-aggregation" // Aggregations finder → Create aggregation dialog
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
