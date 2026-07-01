/**
 * Live **health** of an open-data wrapper, for the Data-sources view: is it reachable, and does
 * its response still carry the shape the app parses? A runtime, in-app cousin of the remote
 * contract tests (`test/headless/contract/`) — cheap enough to run on the credits page.
 *
 * Three states:
 *  - **down** — the probe request failed (network error / non-2xx / CORS): the wrapper is
 *    unreachable, so every layer it feeds is silently empty.
 *  - **available** — reachable (2xx), but the response did NOT match the schema the app parses
 *    (a shape drift — the field/route the app needs is gone, even though the host answers).
 *  - **conformant** — reachable AND the app's own parser extracted a well-formed result.
 *
 * Per-source probes are registered in {@link WRAPPER_PROBES}; a source with no probe returns
 * `null` (no badge). Starting with **mastr**.
 */
import type { SourceId } from "../../constants/dataSources.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { contains, deref, within } from "./capabilities.ts";
import { MASTR_ROUTES, parseInstallations } from "./mastrNearby.ts";
import {
  gemeindeAgsFromContains,
  LAU_ROUTES,
  normalizeRegionGeometry,
  NUTS_ROUTES,
} from "./regionGeometry.ts";
import {
  LOD2_ROUTES,
  parseNearbyBuildings,
  rooftopPointUrl,
} from "./lod2Rooftop.ts";
import {
  fetchPlantGenerationByYear,
  NETZTRANSPARENZ_ROUTES,
  plantUrl,
} from "./netztransparenz.ts";
import {
  fetchNearestStations,
  linkedWeatherBase,
  WEATHER_PARAMETERS,
  WETTERDIENST_ROUTES,
} from "./linkedWeather.ts";
import {
  areaUrl,
  ENERGIEATLAS_ROUTES,
  parseAreaProfile,
} from "./standortEnergieprofil.ts";
import {
  fetchRegionalObservations,
  REGIONAL_TABLES,
  REGIONALSTATISTIK_ROUTES,
  regionalTableDataUrl,
} from "./regionalCube.ts";
import { OSM_ROUTES } from "./geocode.ts";

export type WrapperHealth = "down" | "available" | "conformant";

export interface WrapperStatus {
  health: WrapperHealth;
  /** A short human hint (why available-not-conformant, or the error), for a tooltip. */
  detail?: string;
  /** A representative domain-entity IRI pulled live from the probe (e.g. a MaStR `see/{id}#it`
   *  record) — a "see it for real" link on the Data-sources page. */
  exampleEntity?: string;
}

/** A small WGS84 box of half-width `km` around a point (~111 km/°; lon shrinks by cos). */
function boxAround(lat: number, lon: number, km: number) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return { w: lon - dLon, s: lat - dLat, e: lon + dLon, n: lat + dLat };
}

function shortErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 120 ? m.slice(0, 117) + "…" : m;
}

/**
 * Best-effort check that the wrapper's live `/routes` manifest still lists the routes the app
 * depends on. `checked:false` when the manifest is absent/unreachable (an older wrapper without
 * `/routes`) — the caller must NOT treat that as a failure, only fall back to the data-shape check.
 */
async function requiredRoutesOk(
  id: string,
  required: readonly string[],
): Promise<{ checked: boolean; missing: string[] }> {
  try {
    const res = await getSourceGateway().fetch(
      `${sourceBase(id as SourceId)}routes.json`,
      { headers: { Accept: "application/json" } },
      `${id} routes`,
    );
    if (!res.ok) return { checked: false, missing: [] };
    const body = await res.json() as { routes?: (string | { name?: string })[] };
    const names = new Set(
      (body.routes ?? []).map((r) => (typeof r === "string" ? r : r.name)),
    );
    return { checked: true, missing: required.filter((r) => !names.has(r)) };
  } catch {
    return { checked: false, missing: [] };
  }
}

/**
 * The shared probe TAIL: after a probe's data-shape check passed, verify the
 * wrapper's `/routes` manifest still lists the routes the app calls and fold
 * the result into the verdict — `conformant`, or `available` with the missing
 * routes named. One home for the phrasing (it was copy-pasted per probe).
 */
async function verdictWithRoutes(
  id: Parameters<typeof requiredRoutesOk>[0],
  requiredRoutes: string[],
  exampleEntity?: string,
): Promise<WrapperStatus> {
  const routes = await requiredRoutesOk(id, requiredRoutes);
  return routes.checked && routes.missing.length > 0
    ? {
      health: "available",
      detail: `missing route(s): ${routes.missing.join(", ")}`,
      ...(exampleEntity ? { exampleEntity } : {}),
    }
    : { health: "conformant", ...(exampleEntity ? { exampleEntity } : {}) };
}

/**
 * Probe **linked-mastr** in two steps, tied to the SAME contract as the compile-time route check:
 *  1. **route manifest** (`/routes.json`, the option-C source) — must still list the routes the app
 *     depends on ({@link MASTR_ROUTES}); a missing one is a route drift → `available`.
 *  2. **response shape** — a tiny `within` query over central Nürnberg must parse to a well-formed
 *     installation via the app's own `parseInstallations` (`geo:lat`/`geo:long` + `mastr:Energietraeger`).
 * Any fetch failure → `down`; both pass → `conformant`.
 */
async function probeMastr(): Promise<WrapperStatus> {
  // 1. Response shape: a live `within` query must parse to the nearby-installations shape.
  let store;
  try {
    store = await within(getSourceGateway(), "mastr", boxAround(49.4521, 11.0767, 3), { count: 25 });
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const u = parseInstallations(store)[0];
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.long)) {
    return { health: "available", detail: "reachable, but no installation matched the expected shape" };
  }
  // 2. Interface: the deployed /routes must still list the routes the app calls (best-effort).
  return await verdictWithRoutes("mastr", Object.values(MASTR_ROUTES), u.iri);
}

/**
 * Probe **linked-nuts**: a live region-choropleth query (`geojson?level=1&parent=DE`) must
 * normalize to region features via the app's own `normalizeRegionGeometry`. `down` on fetch
 * failure; `conformant` when features parse (and, best-effort, `/routes` still lists the routes the
 * app calls); `available` otherwise. The example entity is a `nuts/{code}#it` region concept.
 */
async function probeNuts(): Promise<WrapperStatus> {
  const base = sourceBase("nuts");
  let fc;
  try {
    const res = await getSourceGateway().fetch(
      `${base}${NUTS_ROUTES.geojson}?level=1&parent=DE`,
      { headers: { Accept: "application/geo+json" } },
      "nuts geojson",
    );
    if (!res.ok) return { health: "down", detail: `geojson → HTTP ${res.status}` };
    fc = normalizeRegionGeometry(await res.json());
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const f = fc.features[0];
  if (!f) {
    return { health: "available", detail: "reachable, but no region features parsed" };
  }
  const example = `${base}${NUTS_ROUTES.concept}/${f.properties.code}#it`;
  return await verdictWithRoutes("nuts", Object.values(NUTS_ROUTES), example);
}

/**
 * Probe **linked-lau**: a live `/contains` point-in-region lookup over central Nürnberg must
 * resolve to the containing Gemeinde AGS via the app's own `gemeindeAgsFromContains`. `down` on
 * fetch failure; `conformant` when the AGS resolves (and, best-effort, `/routes` still lists the
 * app's routes); `available` otherwise. Example entity: the `lau/DE_{ags}#it` Gemeinde concept.
 */
async function probeLau(): Promise<WrapperStatus> {
  const base = sourceBase("lau");
  let store;
  try {
    store = await contains(getSourceGateway(), "lau", { lat: 49.4521, lon: 11.0767 });
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const ags = gemeindeAgsFromContains(store);
  if (!ags) {
    return { health: "available", detail: "reachable, but no containing Gemeinde resolved" };
  }
  const example = `${base}${LAU_ROUTES.concept}/DE_${ags}#it`;
  return await verdictWithRoutes("lau", Object.values(LAU_ROUTES), example);
}

/**
 * Probe **linked-lod2-by**: a live `nearby` query over central Nürnberg must parse to buildings via
 * the app's own `parseNearbyBuildings`. `down` on fetch failure; `conformant` when a building parses
 * (and, best-effort, `/routes` still lists the app's routes); `available` otherwise. Example entity:
 * the nearest building IRI (`building/{id}#…`).
 */
async function probeLod2(): Promise<WrapperStatus> {
  const lat = 49.4521, long = 11.0767;
  const url = rooftopPointUrl(lat, long, 250);
  let text: string;
  try {
    const res = await getSourceGateway().fetch(
      url,
      { headers: { Accept: "text/turtle" } },
      "lod2-by nearby",
    );
    if (!res.ok) return { health: "down", detail: `nearby → HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const b = parseNearbyBuildings(text, url, lat, long)[0];
  if (!b) {
    return { health: "available", detail: "reachable, but no building parsed" };
  }
  return await verdictWithRoutes("lod2-by", Object.values(LOD2_ROUTES), b.iri);
}

/**
 * Probe **linked-netztransparenz**. The app only ever dereferences per-plant `eeg/{number}` records
 * (a MaStR unit's EEG number → settled generation), so the probe: (1) discovers a live plant number
 * from `filter?count=…` — the wrapper serves `/filter` over the same settled dump the `eeg` records
 * come from; (2) exercises the app's own `fetchPlantGenerationByYear` on it and checks a year of
 * generation parses. `down` on fetch failure; `conformant` when settlements parse (and, best-effort,
 * `/routes` still lists `eeg`); `available` otherwise. Example entity: the plant IRI.
 */
async function probeNetztransparenz(): Promise<WrapperStatus> {
  const base = sourceBase("netztransparenz");
  let numbers: string[];
  try {
    const res = await getSourceGateway().fetch(
      `${base}filter?count=5`,
      { headers: { Accept: "text/turtle" } },
      "netztransparenz filter",
    );
    if (!res.ok) return { health: "down", detail: `filter → HTTP ${res.status}` };
    const text = await res.text();
    numbers = [...new Set([...text.matchAll(/eeg\/(\d+)/g)].map((m) => m[1]))];
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  if (numbers.length === 0) {
    return { health: "available", detail: "reachable, but filter returned no plants" };
  }
  // Exercise the eeg-deref path the app depends on: the first plant with parsed settlements wins.
  for (const n of numbers) {
    const byYear = await fetchPlantGenerationByYear(n);
    if (byYear.size > 0) {
      return await verdictWithRoutes("netztransparenz", Object.values(NETZTRANSPARENZ_ROUTES), plantUrl(n));
    }
  }
  return { health: "available", detail: "reachable, but no plant carried settled generation" };
}

/**
 * Probe **linked-wetterdienst**: a live `near` nearest-station query over central Nürnberg must
 * parse to weather stations via the app's own `fetchNearestStations` (the `near` route + station
 * shape the weather overlay depends on). `down` on fetch failure; `conformant` when a station parses
 * (and, best-effort, `/routes` still lists `near`/`values`); `available` otherwise. Example entity:
 * the nearest station's `station/{id}` record.
 */
async function probeWetterdienst(): Promise<WrapperStatus> {
  let stations;
  try {
    stations = await fetchNearestStations(
      49.4521, 11.0767, 5, WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL, true,
    );
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const s = stations[0];
  if (!s || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) {
    return { health: "available", detail: "reachable, but no station matched the expected shape" };
  }
  const example = `${linkedWeatherBase()}station/${s.station_id}`;
  return await verdictWithRoutes("wetterdienst", Object.values(WETTERDIENST_ROUTES), example);
}

/**
 * Probe **linked-energieatlas**: dereferencing the per-Gemeinde `area/{ags}` profile for Nürnberg
 * (AGS 09564000) must parse to an energy profile via the app's own `fetchAreaProfile` (the one route
 * the Standort-Energieprofil panel depends on). `down` on fetch failure; `conformant` when the
 * profile parses (and, best-effort, `/routes` still lists `area`); `available` otherwise. Example
 * entity: the `area/{ags}` document.
 */
async function probeEnergieatlas(): Promise<WrapperStatus> {
  const ags = "09564000"; // Nürnberg — a Bavarian Gemeinde always present in the export.
  // `deref` throws on a non-2xx / network failure (so we can report `down`), unlike the app's own
  // `fetchAreaProfile` which swallows a 404 to null (a Gemeinde outside Bavaria → no panel).
  let profile;
  try {
    const store = await deref(getSourceGateway(), areaUrl(ags), "energieatlas area profile");
    profile = parseAreaProfile(store);
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  if (!profile) {
    return { health: "available", detail: "reachable, but no area profile parsed" };
  }
  return await verdictWithRoutes("energieatlas", Object.values(ENERGIEATLAS_ROUTES), areaUrl(ags));
}

/**
 * Probe **linked-regionalstatistik**: a live fetch of the first RDF Data Cube table (`data/{tableId}`)
 * for Bavaria (AGS `09`, a `land`-grain table) must parse to observations via the app's own
 * `fetchRegionalObservations` (the `data` route + cube shape the regional layers depend on). `down`
 * on fetch failure; `conformant` when an observation parses (and, best-effort, `/routes` still lists
 * `data`/`cl`); `available` otherwise. Example entity: the `data/{tableId}` cube resource.
 */
async function probeRegionalstatistik(): Promise<WrapperStatus> {
  const table = REGIONAL_TABLES[0]; // 86251-Z-02, land-grain renewable share
  let obs;
  try {
    obs = await fetchRegionalObservations(table, "09"); // Bayern
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  if (obs.length === 0) {
    return { health: "available", detail: "reachable, but no observation matched the expected shape" };
  }
  const example = regionalTableDataUrl(table.tableId);
  return await verdictWithRoutes("regionalstatistik", Object.values(REGIONALSTATISTIK_ROUTES), example);
}

/**
 * Probe **linked-osm**: a live `nominatim/search.json` geocode (the Nominatim proxy the app uses to
 * resolve addresses) must return a GeoJSON feature with finite `[lon, lat]` coordinates — the exact
 * shape `geocodeFields` reads. `down` on fetch failure; `conformant` when coordinates parse (and,
 * best-effort, `/routes` still lists `nominatim/search`); `available` otherwise. The geocoding
 * response is a GeoJSON FeatureCollection with no per-result IRI, so there is no example entity.
 */
async function probeOsm(): Promise<WrapperStatus> {
  const url = `${sourceBase("osm")}${OSM_ROUTES.nominatimSearch}.json?q=${
    encodeURIComponent("Nürnberg")
  }&limit=1`;
  let coords: [number, number] | undefined;
  try {
    const res = await getSourceGateway().fetch(url, {}, "osm geocode");
    if (!res.ok) return { health: "down", detail: `nominatim/search → HTTP ${res.status}` };
    const data = await res.json() as {
      features?: { geometry?: { coordinates?: [number, number] } }[];
    };
    coords = data.features?.[0]?.geometry?.coordinates;
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
    return { health: "available", detail: "reachable, but no geocode feature matched the shape" };
  }
  return await verdictWithRoutes("osm", Object.values(OSM_ROUTES));
}

/** Per-source probes. Extend as sources are added (starting with mastr). */
export const WRAPPER_PROBES: Partial<Record<SourceId, () => Promise<WrapperStatus>>> = {
  mastr: probeMastr,
  nuts: probeNuts,
  lau: probeLau,
  "lod2-by": probeLod2,
  netztransparenz: probeNetztransparenz,
  wetterdienst: probeWetterdienst,
  energieatlas: probeEnergieatlas,
  regionalstatistik: probeRegionalstatistik,
  osm: probeOsm,
};

/** Whether a live-health probe is registered for a source id (bundled/non-fetchable ids like
 *  `pvgis`/`basemap` never have one → no badge). Takes a bare string (the registry's `id`). */
export function hasWrapperProbe(id: string): boolean {
  return id in WRAPPER_PROBES;
}

/** Probe a source's live health, or `null` when no probe is registered for it. */
export function probeWrapper(id: string): Promise<WrapperStatus> | null {
  const probe = (WRAPPER_PROBES as Record<string, () => Promise<WrapperStatus>>)[id];
  return probe ? probe() : null;
}
