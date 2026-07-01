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
import { LAU_ROUTES, NUTS_ROUTES } from "./regionGeometry.ts";
import { LOD2_ROUTES } from "./lod2Rooftop.ts";
import { NETZTRANSPARENZ_ROUTES } from "./netztransparenz.ts";
import { WETTERDIENST_ROUTES } from "./linkedWeather.ts";
import { ENERGIEATLAS_ROUTES } from "./standortEnergieprofil.ts";
import { REGIONALSTATISTIK_ROUTES } from "./regionalCube.ts";
import { OSM_ROUTES } from "./geocode.ts";

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
  nuts: () => {
    const b = sourceBase("nuts");
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: NUTS_ROUTES.geojson, purpose: "region choropleth polygons (level/parent)" },
        { route: NUTS_ROUTES.search, purpose: "region lookup by name/code" },
        { route: NUTS_ROUTES.concept, purpose: "region concept dereference (nuts/{code}#it)" },
      ],
      lidsExamples: [
        { label: "contains → Point", url: `${b}contains?lat=49.45&lon=11.08#id` },
      ],
    };
  },
  lau: () => {
    const b = sourceBase("lau");
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: LAU_ROUTES.contains, purpose: "point → containing Gemeinde (reverse geocode)" },
        { route: LAU_ROUTES.geojson, purpose: "Gemeinde choropleth polygons (parent/bbox)" },
        { route: LAU_ROUTES.search, purpose: "Gemeinde lookup by name/code" },
        { route: LAU_ROUTES.concept, purpose: "Gemeinde concept dereference (lau/DE_{ags}#it)" },
      ],
      lidsExamples: [
        { label: "contains → Point", url: `${b}contains?lat=49.45&lon=11.08#id` },
      ],
    };
  },
  "lod2-by": () => {
    const b = sourceBase("lod2-by");
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: LOD2_ROUTES.nearby, purpose: "buildings near a point → rooftop-PV potential" },
        { route: LOD2_ROUTES.building, purpose: "per-building deref (roof/wall/ground geometry)" },
      ],
      lidsExamples: [
        { label: "nearby → Point", url: `${b}nearby?lon=11.077&lat=49.452&r=100#id` },
        { label: "within → BoundingBox", url: `${b}within?bbox=11.05,49.44,11.10,49.47#id` },
      ],
    };
  },
  netztransparenz: () => {
    const b = sourceBase("netztransparenz");
    return {
      routesUrl: `${b}routes`,
      requires: [
        {
          route: NETZTRANSPARENZ_ROUTES.eeg,
          purpose: "per-plant settled EEG generation (kWh/yr), keyed by MaStR EEG number",
        },
      ],
      // The /filter route is a LIDS Query endpoint; a small `count` keeps the example deref tiny.
      lidsExamples: [
        { label: "filter → Query", url: `${b}filter?source=Solar&count=10#id` },
      ],
    };
  },
  wetterdienst: () => {
    const b = sourceBase("wetterdienst");
    const p = "annual/climate_summary/sunshine_duration";
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: WETTERDIENST_ROUTES.near, purpose: "nearest weather stations to a building" },
        { route: WETTERDIENST_ROUTES.values, purpose: "a station's annual observation series" },
      ],
      // Unlike the sibling wrappers, linked-wetterdienst does NOT reify a `#id` service-call entity:
      // the collection is addressed by its query-document IRI directly (only `#activity`/`#agent`
      // provenance fragments exist). So these examples are the dereferenceable collection documents.
      lidsExamples: [
        { label: "near (stations near a point)", url: `${b}near?coordinates=49.452,11.077&rank=5&parameters=${p}` },
        { label: "bbox (stations in a box)", url: `${b}bbox?bbox=11.05,49.44,11.10,49.47&parameters=${p}` },
      ],
    };
  },
  energieatlas: () => {
    const b = sourceBase("energieatlas");
    return {
      routesUrl: `${b}routes`,
      requires: [
        {
          route: ENERGIEATLAS_ROUTES.area,
          purpose: "per-Gemeinde energy-potential profile (rooftop/ground PV, green, biomass) by AGS",
        },
      ],
      // `area/{ags}` is a path-addressed record route (keyed by AGS), not a parameterised LIDS query
      // service — it reifies no `#id` call entity — so there are no LIDS service-call examples.
      lidsExamples: [],
    };
  },
  regionalstatistik: () => {
    const b = sourceBase("regionalstatistik");
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: REGIONALSTATISTIK_ROUTES.data, purpose: "RDF Data Cube table (qb:Observations) by table id" },
        { route: REGIONALSTATISTIK_ROUTES.cl, purpose: "codelists — cl/geo (AGS→Kreis names), frag-style geo dims" },
      ],
      // A linked-data-cube wrapper: routes are path-addressed cube/codelist resources
      // (data/{table}, cl/{scheme}), not parameterised LIDS `#id` query services.
      lidsExamples: [],
    };
  },
  osm: () => {
    const b = sourceBase("osm");
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: OSM_ROUTES.nominatimSearch, purpose: "geocode addresses → coordinates (Nominatim proxy)" },
      ],
      // The geocoding route is a Nominatim proxy read as GeoJSON (`.json`); the app consumes the
      // FeatureCollection, not a reified `#id` LIDS entity. Shown: the RDF form of a sample search.
      lidsExamples: [
        { label: "nominatim/search (Turtle)", url: `${b}nominatim/search.ttl?q=N%C3%BCrnberg&limit=1` },
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
