/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  dwdVocabNs,
  parseObservations,
  parseStations,
  pickStationForYears,
  WEATHER_PARAMETERS,
  type WeatherStation,
  weatherStationsUrl,
  weatherValuesUrl,
} from "./linkedWeather.ts";

// The URL builders back BOTH the fetch and the Developer-mode source link, which
// must be an ABSOLUTE, dereferenceable wrapper IRI — assert that shape directly.
// Since the DWD-native wrapper (opendata.dwd.de upstream), the product is the server
// default (annual/kl): no `parameters` in the URLs; the column selects client-side.
Deno.test("weatherStationsUrl / weatherValuesUrl build absolute wrapper IRIs", () => {
  const near = weatherStationsUrl(49.45, 11.08, 5);
  assert.match(near, /^https:\/\/[^/]+\/dwd\/near\?/);
  assert.ok(near.includes("latitude=49.45") && near.includes("rank=5"));
  assert.ok(!near.includes("parameters="));

  const values = weatherValuesUrl("03668");
  assert.match(values, /^https:\/\/[^/]+\/dwd\/values\?/);
  assert.ok(values.includes("station=03668") && values.includes("periods=historical%2Crecent"));
  assert.ok(!values.includes("parameters="));

  // active=true adds &active=true (wrapper drops discontinued stations); default omits it.
  assert.ok(!near.includes("active="));
  assert.ok(weatherStationsUrl(49.45, 11.08, 5, true).includes("active=true"));
});

// A faithful slice of a `near` station collection from linked-dwd: each
// `dwd:WeatherStation` carries id/name/coords and (ranked) `schema:distance`; the
// register dates are xsd:date. The second station uses `rdfs:label` instead of
// `dwd:station_name`, and the stations are listed nearest-LAST to prove the parser
// sorts by distance.
const STATIONS_BASE = "https://wunderfacts.com/dwd/near";
const STATIONS_TTL = `
@prefix dwd: <vocab#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<station/01234#it> a dwd:WeatherStation, sosa:Sensor ;
  dwd:station_id "01234" ; rdfs:label "Erlangen" ;
  geo:lat "49.6"^^xsd:float ; geo:long "11.0"^^xsd:float ;
  dwd:start_date "1990-01-01"^^xsd:date ;
  dwd:end_date "1999-12-31"^^xsd:date ;
  schema:distance 12.0 .
<station/03668#it> a dwd:WeatherStation, sosa:Sensor ;
  dwd:station_id "03668" ; dwd:station_name "Nürnberg" ;
  geo:lat "49.503"^^xsd:float ; geo:long "11.0549"^^xsd:float ;
  dwd:start_date "1950-01-01"^^xsd:date ;
  dwd:end_date "2025-12-31"^^xsd:date ;
  schema:distance 2.5 .
`;

// A faithful slice of a `values` observation collection from the DWD-native wrapper:
// ALL present measurement columns of the product ride in one response, each
// observation naming its column via `sosa:observedProperty` (dwd:JA_TT = annual mean
// temperature, dwd:JA_RR = annual precipitation, …), with the aggregation period as
// `dwd:mess_datum_beginn`/`_ende` and `sosa:resultTime` at the period END. Listed
// newest-first to prove the parser sorts ascending; a JA_RR observation is
// interleaved to prove column filtering.
const VALUES_BASE = "https://wunderfacts.com/dwd/values";
const VALUES_TTL = `
@prefix dwd: <vocab#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix unit: <http://qudt.org/1.1/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<station/03668#it> a dwd:WeatherStation ; dwd:station_id "03668" .

<observation/03668_annual.kl.JA_TT_20230101#it>
  a dwd:Observation, sosa:Observation ;
  sosa:madeBySensor <station/03668#it> ;
  sosa:observedProperty dwd:JA_TT ;
  dwd:mess_datum_beginn "2023-01-01"^^xsd:date ;
  dwd:mess_datum_ende "2023-12-31"^^xsd:date ;
  sosa:resultTime "2023-12-31T00:00:00Z"^^xsd:dateTime ;
  dwd:quality 9 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "10.5"^^xsd:float ;
                   qudt:unit unit:DegreeCelsius ] .
<observation/03668_annual.kl.JA_RR_20230101#it>
  a dwd:Observation, sosa:Observation ;
  sosa:madeBySensor <station/03668#it> ;
  sosa:observedProperty dwd:JA_RR ;
  sosa:resultTime "2023-12-31T00:00:00Z"^^xsd:dateTime ;
  dwd:quality 9 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "1124.2"^^xsd:decimal ;
                   qudt:unit unit:Millimeter ] .
<observation/03668_annual.kl.JA_TT_20210101#it>
  a dwd:Observation, sosa:Observation ;
  sosa:madeBySensor <station/03668#it> ;
  sosa:observedProperty dwd:JA_TT ;
  sosa:resultTime "2021-12-31T00:00:00Z"^^xsd:dateTime ;
  dwd:quality 1 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "9.8"^^xsd:float ;
                   qudt:unit unit:DegreeCelsius ] .
`;

Deno.test("dwdVocabNs: vocab# under the wrapper root, whatever the mount or the query", () => {
  assert.equal(dwdVocabNs(STATIONS_BASE), "https://wunderfacts.com/dwd/vocab#");
  assert.equal(
    dwdVocabNs("https://wunderfacts.com/dwd/values?station=03668&periods=historical,recent"),
    "https://wunderfacts.com/dwd/vocab#",
  );
  assert.equal(
    dwdVocabNs("http://localhost:8080/linked-dwd/near"),
    "http://localhost:8080/linked-dwd/vocab#",
  );
});

Deno.test("parseStations: the pre-2026-09-23 opendata.dwd.de namespace no longer matches", () => {
  // linked-dwd moved its terms to its own vocab#; a document in the old namespace is not ours.
  const old = STATIONS_TTL.replace(
    "@prefix dwd: <vocab#> .",
    "@prefix dwd: <https://opendata.dwd.de/#> .",
  );
  assert.deepEqual(parseStations(old, STATIONS_BASE), []);
});

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

Deno.test("parseObservations: selects the requested column, sorted ascending by date", () => {
  const obs = parseObservations(
    VALUES_TTL,
    VALUES_BASE,
    WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL,
  );
  assert.deepEqual(obs, [
    { date: "2021-12-31T00:00:00Z", value: 9.8, quality: 1 },
    { date: "2023-12-31T00:00:00Z", value: 10.5, quality: 9 },
  ]);
});

Deno.test("parseObservations: a different column selects the interleaved observation", () => {
  const obs = parseObservations(
    VALUES_TTL,
    VALUES_BASE,
    WEATHER_PARAMETERS.PRECIPITATION_ANNUAL,
  );
  assert.deepEqual(obs, [{ date: "2023-12-31T00:00:00Z", value: 1124.2, quality: 9 }]);
});

Deno.test("parseObservations: sunshine arrives in hours (the column's natural unit)", () => {
  const ttl = `
@prefix dwd: <vocab#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix unit: <http://qudt.org/1.1/vocab/unit#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<observation/x#it> a sosa:Observation ;
  sosa:observedProperty dwd:JA_SD_S ;
  sosa:resultTime "2023-12-31T00:00:00Z"^^xsd:dateTime ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue "1648.7"^^xsd:decimal ;
                   qudt:unit unit:Hour ] .
`;
  const obs = parseObservations(ttl, VALUES_BASE, WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 1648.7);
  assert.equal(obs[0].quality, undefined);
});
