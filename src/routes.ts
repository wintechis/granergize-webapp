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
