/**
 * The **interface the app requires** of an open-data wrapper, for the Data-sources view: the route
 * manifest, the routes the app calls (+ what each is for), and dereferenceable **example entities**
 * — both a plain domain entity and the wrapper's **LIDS** service-call entities (the `#id` inputs).
 * Static, per-source metadata (URLs built from the registry base + the app's own dependency on the
 * wrapper); the live example domain-entity IRI comes from the probe ({@link WrapperStatus.exampleEntity}).
 * Starting with **mastr**.
 */
import type { SourceId } from "../../constants/dataSources.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { MASTR_ROUTES } from "./mastrNearby.ts";

/** One route the app depends on, and what it uses it for. */
export interface RequiredRoute {
  route: string;
  purpose: string;
}

/** A named, dereferenceable example URL (a domain entity, or a LIDS service-call entity). */
export interface ExampleLink {
  label: string;
  url: string;
}

export interface WrapperContract {
  /** The live route manifest (option-C source of truth). */
  routesUrl: string;
  /** The routes the app calls on this wrapper, with their purpose. */
  requires: RequiredRoute[];
  /** LIDS service-call example entities — the `<call?params#id>` inputs the wrapper reifies. */
  lidsExamples: ExampleLink[];
}

/** Per-source contract descriptors. Extend as sources are added. */
const CONTRACTS: Record<string, () => WrapperContract> = {
  mastr: () => {
    const b = sourceBase("mastr");
    const box = "11.0,49.4,11.12,49.5";
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: MASTR_ROUTES.within, purpose: "nearby renewable installations in a bounding box" },
        { route: MASTR_ROUTES.filter, purpose: "installations by Gemeinde/Kreis AGS" },
      ],
      // Bounded with a small `count` so the example derefs are tiny (illustrate the LIDS call
      // entity, not dump a Gemeinde's ~60k units / all Bavaria's ~300k).
      lidsExamples: [
        { label: "within → BoundingBox", url: `${b}within?bbox=${box}&count=10#id` },
        { label: "filter → Query", url: `${b}filter?ags=09564000&count=10#id` },
      ],
    };
  },
};

export function hasWrapperContract(id: string): boolean {
  return id in CONTRACTS;
}

/** The interface contract the app requires of a source, or `null` if none is described. */
export function wrapperContract(id: string): WrapperContract | null {
  return CONTRACTS[id]?.() ?? null;
}

/** One route as described by the wrapper's live `/routes` manifest. */
export interface RouteInfo {
  name: string;
  /** Representation formats the route serves (e.g. `ttl`, `geojson`); empty = content-negotiated. */
  formats: string[];
  /** Query params the route accepts (e.g. `bbox`, `ags`, `count`, `offset`); empty = none/unknown. */
  params: string[];
}

/** True when the route paginates — the manifest lists BOTH `count` and `offset`. */
export function isPaginated(info: RouteInfo): boolean {
  return info.params.includes("count") && info.params.includes("offset");
}

/**
 * The wrapper's LIVE interface manifest (`/routes.json`) — the deployed truth for what each route
 * accepts/serves, so the Data-sources panel describes the interface faithfully (pagination, params,
 * formats) instead of hand-maintaining it. Tolerant of the older name-array manifest (→ no
 * params/formats). Keyed by route name.
 */
export async function fetchRouteManifest(id: string): Promise<Map<string, RouteInfo>> {
  const res = await getSourceGateway().fetch(
    `${sourceBase(id as SourceId)}routes.json`,
    { headers: { Accept: "application/json" } },
    `${id} routes manifest`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching routes manifest`);
  const body = await res.json() as { routes?: (string | Partial<RouteInfo>)[] };
  const map = new Map<string, RouteInfo>();
  for (const r of body.routes ?? []) {
    const info: RouteInfo = typeof r === "string"
      ? { name: r, formats: [], params: [] }
      : { name: r.name ?? "", formats: r.formats ?? [], params: r.params ?? [] };
    if (info.name) map.set(info.name, info);
  }
  return map;
}
