/**
 * Read weather from the **`linked-wetterdienst`** Linked Data wrapper
 * (`https://wunderfacts.com/wetterdienst`) by dereferencing its Turtle — the
 * follow-your-nose sibling of {@link ./regionalCube.ts} (which reads
 * `linked-regionalstatistik` the same way). The wrapper re-publishes German weather
 * (Deutscher Wetterdienst, via the wetterdienst service) as SOSA/QUDT RDF, and
 * already applies the QUDT unit conversions (e.g. sunshine seconds→hours), so the
 * values arrive display-ready.
 *
 * Two discovery reads:
 * - `near?latitude&longitude&rank&parameters` → nearest `dwd:WeatherStation`s, each
 *   with `schema:distance`.
 * - `values?station&parameters&periods=recent` → a station's `sosa:Observation`s,
 *   each a `qudt:QuantityValue` result.
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
} from "./rdf/vocabularies.ts";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { trackedFetch } from "../lib/networkActivity.ts";
import type { WeatherAnnualValue } from "./energy/energyWeather.ts";

const { namedNode } = DataFactory;

/**
 * The weather datasets the wrapper/upstream expose, as `{resolution}/{dataset}/{parameter}`
 * paths. Replaces the former `@wintechis/wetterdienst-rdf-adapter` `WeatherParameters` enum.
 */
export const WEATHER_PARAMETERS = {
  TEMPERATURE_MEAN_ANNUAL: "annual/climate_summary/temperature_air_mean_2m",
  SUNSHINE_DURATION_ANNUAL: "annual/climate_summary/sunshine_duration",
  PRECIPITATION_ANNUAL: "annual/climate_summary/precipitation_height",
} as const;

/** A weather station as surfaced in the UI. `distance` (km) is present on ranked results. */
export interface WeatherStation {
  station_id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance?: number;
}

/** One annual observation: an ISO date + value (already unit-converted), with quality flag. */
export interface WeatherObservation extends WeatherAnnualValue {
  quality?: number;
}

/** Base URI of the wrapper (the CORS-enabled host — fetched directly, no dev proxy).
 * Read lazily so importing this module for the pure parsers (tests) never touches
 * `import.meta.env`. */
export function linkedWeatherBase(): string {
  // Cast (not bare `import.meta.env`) so deno's type-checker accepts it; Vite injects
  // `import.meta.env` for the browser build. Same pattern as `regionalCube.ts`.
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_WEATHER_API_URI || "https://wunderfacts.com/wetterdienst/";
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
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p === `${DWD_NS}station_id`) stationId = q.object.value;
      else if (p === `${DWD_NS}station_name`) name = q.object.value;
      else if (p === `${RDFS_NS}label`) label = q.object.value;
      else if (p === GEO_LAT) latitude = Number.parseFloat(q.object.value);
      else if (p === GEO_LONG) longitude = Number.parseFloat(q.object.value);
      else if (p === `${SCHEMA_NS}distance`) distance = Number.parseFloat(q.object.value);
    }
    if (stationId) {
      out.push({ station_id: stationId, name: name || label, latitude, longitude, distance });
    }
  }
  return out.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}

/**
 * Parse a `values` Turtle document into a station's observations, sorted ascending by date.
 * Pure (network-free). Each `sosa:Observation` yields its `sosa:resultTime` (date), the
 * `qudt:numericValue` of its `sosa:hasResult` `qudt:QuantityValue`, and `dwd:quality`.
 */
export function parseObservations(turtle: string, baseIri: string): WeatherObservation[] {
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
    let date = "";
    let quality: number | undefined;
    let resultNode = null;
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value;
      if (p === `${SOSA_NS}resultTime`) date = q.object.value;
      else if (p === `${DWD_NS}quality`) quality = Number.parseInt(q.object.value, 10);
      else if (p === `${SOSA_NS}hasResult`) resultNode = q.object;
    }
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
 *  for the nearest stations to a coordinate. Absolute (the CORS-enabled host). */
export function weatherStationsUrl(
  latitude: number,
  longitude: number,
  rank: number,
  parameters: string,
): string {
  return `${linkedWeatherBase()}near?` +
    new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      rank: String(rank),
      parameters,
    });
}

/** The dereferenceable `values?…` query IRI (and the Developer-mode source link)
 *  for one station + parameter's recent observations. Absolute. */
export function weatherValuesUrl(stationId: string, parameters: string): string {
  return `${linkedWeatherBase()}values?` +
    new URLSearchParams({ station: stationId, parameters, periods: "recent" });
}

/** Fetch + parse the nearest `rank` stations to a coordinate for a parameter dataset. */
export async function fetchNearestStations(
  latitude: number,
  longitude: number,
  rank: number,
  parameters: string,
): Promise<WeatherStation[]> {
  const url = weatherStationsUrl(latitude, longitude, rank, parameters);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "weather stations",
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching nearest weather stations`);
  return parseStations(await res.text(), url);
}

/** Fetch + parse the recent observations for one station + parameter dataset. */
export async function fetchStationValues(
  stationId: string,
  parameters: string,
): Promise<WeatherObservation[]> {
  const url = weatherValuesUrl(stationId, parameters);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    "weather data",
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching weather values`);
  return parseObservations(await res.text(), url);
}
