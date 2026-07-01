/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  parseObservations,
  parseStations,
  pickStationForYears,
  weatherStationsUrl,
  type WeatherStation,
  weatherValuesUrl,
} from "./linkedWeather.ts";

// The URL builders back BOTH the fetch and the Developer-mode source link, which
// must be an ABSOLUTE, dereferenceable wrapper IRI — assert that shape directly.
Deno.test("weatherStationsUrl / weatherValuesUrl build absolute wrapper IRIs", () => {
  const near = weatherStationsUrl(49.45, 11.08, 5, "annual/x/temp");
  assert.match(near, /^https:\/\/[^/]+\/wetterdienst\/near\?/);
  assert.ok(near.includes("latitude=49.45") && near.includes("rank=5"));
  // The parameter path's "/" must be percent-encoded inside the query.
  assert.ok(near.includes("parameters=annual%2Fx%2Ftemp"));

  const values = weatherValuesUrl("03668", "annual/x/temp");
  assert.match(values, /^https:\/\/[^/]+\/wetterdienst\/values\?/);
  assert.ok(values.includes("station=03668") && values.includes("periods=historical%2Crecent"));

  // active=true adds &active=true (wrapper drops discontinued stations); default omits it.
  assert.ok(!near.includes("active="));
  assert.ok(weatherStationsUrl(49.45, 11.08, 5, "annual/x/temp", true).includes("active=true"));
});

// A faithful slice of a `near` station collection from linked-wetterdienst: each
// `dwd:WeatherStation` carries id/name/coords and (ranked) `schema:distance`. The
// second station uses `rdfs:label` instead of `dwd:station_name`, and the stations
// are listed nearest-LAST to prove the parser sorts by distance.
const STATIONS_BASE = "https://wunderfacts.com/wetterdienst/near";
const STATIONS_TTL = `
@prefix dwd: <https://opendata.dwd.de/#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<station/01234#it> a dwd:WeatherStation, sosa:Sensor ;
  dwd:station_id "01234" ; rdfs:label "Erlangen" ;
  geo:lat "49.6"^^xsd:float ; geo:long "11.0"^^xsd:float ;
  dwd:start_date "1990-01-01T00:00:00Z"^^xsd:dateTime ;
  dwd:end_date "1999-12-31T00:00:00Z"^^xsd:dateTime ;
  schema:distance 12.0 .
<station/03668#it> a dwd:WeatherStation, sosa:Sensor ;
  dwd:station_id "03668" ; dwd:station_name "Nürnberg" ;
  geo:lat "49.503"^^xsd:float ; geo:long "11.0549"^^xsd:float ;
  dwd:start_date "1950-01-01T00:00:00Z"^^xsd:dateTime ;
  dwd:end_date "2025-12-31T00:00:00Z"^^xsd:dateTime ;
  schema:distance 2.5 .
`;

// A faithful slice of a `values` observation collection: each `sosa:Observation`
// carries `sosa:resultTime`, `dwd:quality`, and a `qudt:QuantityValue` result whose
// `qudt:numericValue` is already unit-converted by the wrapper (sunshine in hours).
// Listed newest-first to prove the parser sorts ascending by date.
const VALUES_BASE = "https://wunderfacts.com/wetterdienst/values";
const VALUES_TTL = `
@prefix dwd: <https://opendata.dwd.de/#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix unit: <http://qudt.org/1.1/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<station/03668#it> a dwd:WeatherStation ; dwd:station_id "03668" .

<observation/03668_annual.climate_summary.temperature_air_mean_2m_b#it>
  a dwd:Observation, sosa:Observation ;
  sosa:madeBySensor <station/03668#it> ;
  sosa:resultTime "2023-01-01T00:00:00Z"^^xsd:dateTime ;
  dwd:quality 9 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "10.5"^^xsd:float ;
                   qudt:unit unit:DegreeCelsius ] .
<observation/03668_annual.climate_summary.temperature_air_mean_2m_a#it>
  a dwd:Observation, sosa:Observation ;
  sosa:madeBySensor <station/03668#it> ;
  sosa:resultTime "2021-01-01T00:00:00Z"^^xsd:dateTime ;
  dwd:quality 1 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "9.8"^^xsd:float ;
                   qudt:unit unit:DegreeCelsius ] .
`;

Deno.test("parseStations: id/name (label fallback)/coords/distance, sorted nearest-first", () => {
  const stations = parseStations(STATIONS_TTL, STATIONS_BASE);
  assert.deepEqual(stations, [
    {
      station_id: "03668",
      name: "Nürnberg",
      latitude: 49.503,
      longitude: 11.0549,
      distance: 2.5,
      startYear: 1950,
      endYear: 2025,
    },
    {
      station_id: "01234",
      name: "Erlangen", // from rdfs:label (no dwd:station_name)
      latitude: 49.6,
      longitude: 11.0,
      distance: 12.0,
      startYear: 1990,
      endYear: 1999,
    },
  ]);
});

// ── pickStationForYears: overlap-aware selection (option 2) ──────────────────────────
const NEAR_OLD: WeatherStation = {
  station_id: "old", name: "Old", latitude: 0, longitude: 0,
  distance: 2, startYear: 1950, endYear: 1974, // discontinued but NEAREST
};
const FAR_ACTIVE: WeatherStation = {
  station_id: "active", name: "Active", latitude: 0, longitude: 0,
  distance: 8, startYear: 1975, endYear: 2025, // farther but covers recent years
};

Deno.test("pickStationForYears: overlap skips the nearer discontinued station", () => {
  // nearest-first order; 2020s energy overlaps only the active station.
  assert.equal(
    pickStationForYears([NEAR_OLD, FAR_ACTIVE], [2021, 2022, 2023])?.station_id,
    "active",
  );
});

Deno.test("pickStationForYears: no energy years yet → the nearest candidate", () => {
  assert.equal(pickStationForYears([NEAR_OLD, FAR_ACTIVE], [])?.station_id, "old");
});

Deno.test("pickStationForYears: none overlap → nearest candidate (a station beats none)", () => {
  assert.equal(pickStationForYears([NEAR_OLD], [2021])?.station_id, "old");
});

Deno.test("pickStationForYears: open-ended (no years) station always overlaps; empty → null", () => {
  const openEnded: WeatherStation = { station_id: "x", name: "", latitude: 0, longitude: 0, distance: 1 };
  assert.equal(pickStationForYears([openEnded], [2021])?.station_id, "x");
  assert.equal(pickStationForYears([], [2021]), null);
});

Deno.test("parseObservations: date/value/quality from QUDT result, sorted ascending by date", () => {
  const obs = parseObservations(VALUES_TTL, VALUES_BASE);
  assert.deepEqual(obs, [
    { date: "2021-01-01T00:00:00Z", value: 9.8, quality: 1 },
    { date: "2023-01-01T00:00:00Z", value: 10.5, quality: 9 },
  ]);
});

Deno.test("parseObservations: sunshine value passes through as already-converted hours", () => {
  const ttl = `
@prefix dwd: <https://opendata.dwd.de/#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix unit: <http://qudt.org/1.1/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<observation/x#it> a sosa:Observation ;
  sosa:resultTime "2023-01-01T00:00:00Z"^^xsd:dateTime ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "1.5"^^xsd:decimal ;
                   qudt:unit unit:Hour ] .
`;
  const obs = parseObservations(ttl, VALUES_BASE);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 1.5);
  assert.equal(obs[0].quality, undefined);
});
