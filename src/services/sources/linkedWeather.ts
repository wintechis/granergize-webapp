/**
 * Read weather from the **`linked-dwd`** Linked Data wrapper
 * (`https://wunderfacts.com/dwd`) by dereferencing its Turtle — the
 * follow-your-nose sibling of {@link ./regionalCube.ts} (which reads
 * `linked-regionalstatistik` the same way). The wrapper re-publishes German weather
 * **straight from the DWD open data server** (CDC `annual/kl` product) as SOSA/QUDT
 * RDF in DWD-native terms: observed properties are the CDC columns (`dwd:JA_TT` mean
 * temperature °C, `dwd:JA_SD_S` sunshine hours, `dwd:JA_RR` precipitation mm), in
 * their natural units — display-ready without conversion.
 *
 * Two discovery reads:
 * - `near?latitude&longitude&rank&active` → nearest `dwd:WeatherStation`s, each with
 *   `schema:distance`.
 * - `values?station&periods=historical,recent` → a station's `sosa:Observation`s —
 *   ALL measurement columns of the product in one response, each naming its column
 *   via `sosa:observedProperty`; {@link parseObservations} selects the wanted column.
 *   (Annual data lives in `historical`; `recent` alone is near-empty for annual
 *   resolution — see {@link weatherValuesUrl}.)
 *
 * Reached through {@link trackedFetch} so requests show in the global loading
 * indicator and retry transient throttling. The parse halves are split out pure for
 * offline unit-testing.
 */
import { DataFactory } from "n3";
import {
  DWD_NS,
  GEO_LAT,
  GEO_LONG,
  QUDT_SCHEMA_NS,
  RDF_TYPE,
  RDFS_NS,
  SCHEMA_NS,
  SOSA_NS,
} from "../rdf/vocabularies.ts";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import type { WeatherAnnualValue } from "../energy/energyWeather.ts";
import type { DwdRoute } from "../../generated/dwd.routes.ts";

const { namedNode } = DataFactory;

/**
 * The linked-dwd routes the app calls, checked at COMPILE TIME against the wrapper's
 * DEPLOYED route set (`src/generated/dwd.routes.ts`, regenerated from the live `/routes`
 * manifest — `deno task gen:routes:dwd`). `near` = nearest-station discovery; `values` =
 * a station's observations. A rename/removal upstream makes the literal unassignable to
 * {@link DwdRoute}, so `deno task check` fails rather than the weather overlay silently
 * emptying. See `explore/explore-wrapper-contract-drift.md`.
 */
export const DWD_ROUTES = {
  near: "near",
  values: "values",
} as const satisfies Record<string, DwdRoute>;

/**
 * The weather observables the app reads, as **CDC column names** of the wrapper's
 * `annual/kl` product (the DWD-native vocabulary: `dwd:JA_TT` etc.). A `values`
 * response carries all columns; these select client-side in {@link parseObservations}.
 * Values are already in the columns' natural units (°C, hours, mm).
 */
export const WEATHER_PARAMETERS = {
  TEMPERATURE_MEAN_ANNUAL: "JA_TT",
  SUNSHINE_DURATION_ANNUAL: "JA_SD_S",
  PRECIPITATION_ANNUAL: "JA_RR",
} as const;

/** A weather station as surfaced in the UI. `distance` (km) is present on ranked results;
 *  `startYear`/`endYear` (from `dwd:start_date`/`dwd:end_date`) bound the station's recording
 *  period — a discontinued station has an `endYear` in the past. */
export interface WeatherStation {
  station_id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance?: number;
  startYear?: number;
  endYear?: number;
}

/** The 4-digit year at the start of an ISO date/instant, or undefined. */
function yearOf(iso: string): number | undefined {
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1700 && y <= 2200 ? y : undefined;
}

/** One annual observation: an ISO date + value (already unit-converted), with quality flag. */
export interface WeatherObservation extends WeatherAnnualValue {
  quality?: number;
}

/** Base IRI of linked-dwd — delegates to the registry resolver (env-overridable). */
export function linkedWeatherBase(): string {
  return sourceBase("dwd");
}

/**
 * Parse a `near`/`values` Turtle document into its weather stations. Pure (network-free).
 * Each `dwd:WeatherStation` yields its id, name (`dwd:station_name`, else `rdfs:label`),
 * coordinates and — when ranked — `schema:distance`. Sorted nearest-first (quad order is
 * not significant), so callers can take `[0]` as the closest station.
 */
export function parseStations(turtle: string, baseIri: string): WeatherStation[] {
  const store = parseRdfText(turtle, baseIri);
  const out: WeatherStation[] = [];
  for (
    const { subject } of store.getQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${DWD_NS}WeatherStation`),
      null,
    )
  ) {
    let stationId = "";
    let name = "";
    let label = "";
    let latitude = NaN;
    let longitude = NaN;
    let distance: number | undefined;
    let startYear: number | undefined;
    let endYear: number | undefined;
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p === `${DWD_NS}station_id`) stationId = q.object.value;
      else if (p === `${DWD_NS}station_name`) name = q.object.value;
      else if (p === `${RDFS_NS}label`) label = q.object.value;
      else if (p === GEO_LAT) latitude = Number.parseFloat(q.object.value);
      else if (p === GEO_LONG) longitude = Number.parseFloat(q.object.value);
      else if (p === `${SCHEMA_NS}distance`) distance = Number.parseFloat(q.object.value);
      else if (p === `${DWD_NS}start_date`) startYear = yearOf(q.object.value);
      else if (p === `${DWD_NS}end_date`) endYear = yearOf(q.object.value);
    }
    if (stationId) {
      out.push({
        station_id: stationId,
        name: name || label,
        latitude,
        longitude,
        distance,
        startYear,
        endYear,
      });
    }
  }
  return out.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}

/**
 * Parse a `values` Turtle document into a station's observations **of one column**,
 * sorted ascending by date. Pure (network-free). The response interleaves every
 * measurement column of the product, so observations are selected by their
 * `sosa:observedProperty` (`dwd:{column}`); each yields its `sosa:resultTime` (the
 * aggregation-period end), the `qudt:numericValue` of its `sosa:hasResult`
 * `qudt:QuantityValue`, and `dwd:quality`.
 */
export function parseObservations(
  turtle: string,
  baseIri: string,
  column: string,
): WeatherObservation[] {
  const store = parseRdfText(turtle, baseIri);
  const out: WeatherObservation[] = [];
  for (
    const { subject } of store.getQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${SOSA_NS}Observation`),
      null,
    )
  ) {
    let observed = "";
    let date = "";
    let quality: number | undefined;
    let resultNode = null;
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p === `${SOSA_NS}observedProperty`) observed = q.object.value;
      else if (p === `${SOSA_NS}resultTime`) date = q.object.value;
      else if (p === `${DWD_NS}quality`) quality = Number.parseInt(q.object.value, 10);
      else if (p === `${SOSA_NS}hasResult`) resultNode = q.object;
    }
    if (observed !== `${DWD_NS}${column}`) continue;
    let value: number | null = null;
    if (resultNode) {
      for (
        const q of store.getQuads(
          resultNode,
          namedNode(`${QUDT_SCHEMA_NS}numericValue`),
          null,
          null,
        )
      ) {
        value = Number.parseFloat(q.object.value);
      }
    }
    if (date && value != null && !Number.isNaN(value)) {
      out.push({ date, value, quality });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The dereferenceable `near?…` query IRI (and the Developer-mode source link)
 *  for the nearest stations to a coordinate. Absolute (the CORS-enabled host).
 *  Discovery is column-independent (the wrapper serves one product, `annual/kl`).
 *  `active` adds `&active=true` — the wrapper drops discontinued stations before the
 *  `rank` cut; the client-side {@link pickStationForYears} overlap filter additionally
 *  excludes stations whose series misses the plotted years. */
export function weatherStationsUrl(
  latitude: number,
  longitude: number,
  rank: number,
  active = false,
): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    rank: String(rank),
  });
  if (active) params.set("active", "true");
  return `${linkedWeatherBase()}${DWD_ROUTES.near}?${params}`;
}

/**
 * Choose the station whose recording period best fits the years we need to overlay. Given
 * candidates **nearest-first** (as {@link parseStations} returns) and the `energyYears` the
 * overlay will plot against, returns the NEAREST station whose `[startYear, endYear]` overlaps the
 * energy year range — so a discontinued nearest station (e.g. one that stopped in 1974) is skipped
 * for a farther one that actually covers the building's energy years. Pure.
 *
 * Falls back to the nearest candidate when no `energyYears` are known yet, or when none overlap
 * (better a station than none — the chart then simply shows no aligned points). A candidate with
 * no `startYear`/`endYear` is treated as open-ended (always overlaps).
 */
export function pickStationForYears(
  stations: readonly WeatherStation[],
  energyYears: readonly number[],
): WeatherStation | null {
  if (stations.length === 0) return null;
  if (energyYears.length === 0) return stations[0]; // nearest (already nearest-first)
  const eMin = Math.min(...energyYears);
  const eMax = Math.max(...energyYears);
  const overlapping = stations.find((s) =>
    (s.startYear ?? -Infinity) <= eMax && (s.endYear ?? Infinity) >= eMin
  );
  return overlapping ?? stations[0];
}

/** The dereferenceable `values?…` query IRI (and the Developer-mode source link)
 *  for one station's observations (all columns; the column selects at parse time).
 *  Absolute.
 *
 *  Uses `periods=historical,recent` (not `recent` alone): for the **annual** climate datasets
 *  this app reads, the DWD `recent` file (last ~500 days) holds few or NO completed annual rows —
 *  a discontinued nearest station (e.g. Nürnberg-Buchenbuehl 03666) has an empty `recent` and the
 *  overlay showed nothing. `historical` carries the finalized annual series; adding `recent` keeps
 *  the latest year for still-active stations. */
export function weatherValuesUrl(stationId: string): string {
  return `${linkedWeatherBase()}${DWD_ROUTES.values}?` +
    new URLSearchParams({ station: stationId, periods: "historical,recent" });
}

/** Fetch + parse the nearest `rank` stations to a coordinate.
 *  `active` asks the wrapper to drop discontinued stations (see {@link weatherStationsUrl}). */
export async function fetchNearestStations(
  latitude: number,
  longitude: number,
  rank: number,
  active = false,
): Promise<WeatherStation[]> {
  const url = weatherStationsUrl(latitude, longitude, rank, active);
  const res = await getSourceGateway().fetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "weather stations",
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching nearest weather stations`);
  return parseStations(await res.text(), url);
}

/** Fetch a station's observations and select one column ({@link WEATHER_PARAMETERS}). */
export async function fetchStationValues(
  stationId: string,
  column: string,
): Promise<WeatherObservation[]> {
  const url = weatherValuesUrl(stationId);
  const res = await getSourceGateway().fetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "weather data",
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching weather values`);
  return parseObservations(await res.text(), url, column);
}
