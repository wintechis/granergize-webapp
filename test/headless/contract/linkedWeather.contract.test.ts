/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-wetterdienst` — the live weather source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/wetterdienst`,
 * override `VITE_WEATHER_API_URI`) and drives the app's OWN parsers + station picker. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/linkedWeather.test.ts` use fixtures.
 *
 * Exercises the whole EnergyWeatherOverlay path end-to-end and guards two fixes:
 *  - **period fix**: `weatherValuesUrl` asks `periods=historical,recent` (annual data lives in
 *    `historical`; `recent` alone is empty for annual resolution);
 *  - **station selection (option 2/3)**: `near?…&active=true` + `pickStationForYears` skip the
 *    discontinued nearest station (Nürnberg's nearest, 03666, ended 1974) for a farther ACTIVE one
 *    whose recording period overlaps the building's (recent) energy years. `active=true` degrades
 *    gracefully on an un-redeployed wrapper — the overlap filter still excludes the stale station.
 */
import { assert } from "jsr:@std/assert";
import {
  parseObservations,
  parseStations,
  pickStationForYears,
  weatherStationsUrl,
  weatherValuesUrl,
  WEATHER_PARAMETERS,
} from "../../../src/services/sources/linkedWeather.ts";

const PARAM = WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL;
const NBG = { lat: 49.4521, lon: 11.0767 };
// A building's typical (recent) energy-observation years the overlay plots against.
const ENERGY_YEARS = [2020, 2021, 2022, 2023];

async function getTurtle(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);
  return await res.text();
}

Deno.test("contract: live wetterdienst → app picks an ACTIVE nearby station with recent annual data", async () => {
  // near (active) → candidate stations, each with its recording period (dwd:start_date/end_date).
  const stationsUrl = weatherStationsUrl(NBG.lat, NBG.lon, 5, PARAM, true);
  const stations = parseStations(await getTurtle(stationsUrl), stationsUrl);
  assert(stations.length > 0, "at least one nearby station");
  assert(stations.some((s) => typeof s.endYear === "number"), "stations expose an endYear");

  // The overlay picks the nearest station whose period overlaps the energy years — not the
  // (possibly discontinued) geographically nearest.
  const chosen = pickStationForYears(stations, ENERGY_YEARS);
  assert(chosen, "a station is chosen");
  assert(
    (chosen!.endYear ?? 0) >= 2020,
    `chosen station reaches the present (endYear ${chosen!.endYear}) — not a discontinued one`,
  );

  // Its values (periods=historical,recent) include a recent year → the overlay actually aligns.
  const valuesUrl = weatherValuesUrl(chosen!.station_id, PARAM);
  assert(valuesUrl.includes("historical"), "values query spans the historical period");
  const obs = parseObservations(await getTurtle(valuesUrl), valuesUrl);
  assert(obs.length > 0, `chosen station ${chosen!.station_id} yields observations`);
  const maxYear = Math.max(...obs.map((o) => Number.parseInt(o.date.slice(0, 4), 10)));
  assert(maxYear >= 2020, `chosen station has recent observations (latest year ${maxYear})`);
});
