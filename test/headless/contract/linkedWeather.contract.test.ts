/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-wetterdienst` — the live weather source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/wetterdienst`,
 * override `VITE_WEATHER_API_URI`) and drives the app's OWN parsers. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/linkedWeather.test.ts` use fixtures.
 *
 * Two app reads: `near?…` → `parseStations` (nearest `dwd:WeatherStation`s), then `values?…` →
 * `parseObservations` (a station's annual `sosa:Observation`s). Guards the period fix: the app
 * now asks `periods=historical,recent` — with `periods=recent` alone the ANNUAL series is empty
 * for the nearest (often discontinued) station, so the weather overlay rendered nothing.
 */
import { assert } from "jsr:@std/assert";
import {
  parseObservations,
  parseStations,
  weatherStationsUrl,
  weatherValuesUrl,
  WEATHER_PARAMETERS,
} from "../../../src/services/sources/linkedWeather.ts";

const PARAM = WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL;
const NBG = { lat: 49.4521, lon: 11.0767 };

async function getTurtle(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);
  return await res.text();
}

Deno.test("contract: live wetterdienst near+values → app parses an annual temperature series", async () => {
  // near → nearest stations (mirrors the overlay's rank=1 pick).
  const stationsUrl = weatherStationsUrl(NBG.lat, NBG.lon, 3, PARAM);
  const stations = parseStations(await getTurtle(stationsUrl), stationsUrl);
  assert(stations.length > 0, "at least one nearby WeatherStation");
  const nearest = stations[0];
  assert(nearest.station_id !== "", "station has an id");
  assert(typeof nearest.distance === "number", "ranked stations carry a distance");

  // values for the NEAREST station — the case that broke: with periods=recent alone this annual
  // series is empty for a discontinued nearest station; periods=historical,recent populates it.
  const valuesUrl = weatherValuesUrl(nearest.station_id, PARAM);
  assert(valuesUrl.includes("historical"), "values query includes the historical period");
  const obs = parseObservations(await getTurtle(valuesUrl), valuesUrl);
  assert(obs.length > 0, `nearest station ${nearest.station_id} yields annual observations`);
  const o = obs[0];
  assert(/^\d{4}-\d{2}-\d{2}/.test(o.date), "an ISO observation date");
  assert(Number.isFinite(o.value), "a numeric temperature value");
});
