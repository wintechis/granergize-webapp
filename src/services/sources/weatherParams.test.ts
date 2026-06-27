/// <reference lib="deno.ns" />
// Tier-1: the Weather sub-state URI resolver (omit-default + preserve-rest, and the
// parameter→station reset).
import { strict as assert } from "node:assert";
import { WEATHER_PARAMETERS } from "./linkedWeather.ts";
import {
  DEFAULT_WEATHER_PARAM,
  resolveWeatherParameter,
  resolveWeatherStation,
  weatherParameterToParams,
  weatherStationToParams,
} from "./weatherParams.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveWeatherParameter: absent/unknown → default; known → itself", () => {
  assert.equal(resolveWeatherParameter(p("")), DEFAULT_WEATHER_PARAM);
  assert.equal(resolveWeatherParameter(p("wp=bogus")), DEFAULT_WEATHER_PARAM);
  assert.equal(
    resolveWeatherParameter(p(`wp=${WEATHER_PARAMETERS.PRECIPITATION_ANNUAL}`)),
    WEATHER_PARAMETERS.PRECIPITATION_ANNUAL,
  );
});

Deno.test("resolveWeatherStation: absent → null; present → the id", () => {
  assert.equal(resolveWeatherStation(p("")), null);
  assert.equal(resolveWeatherStation(p("ws=00433")), "00433");
});

Deno.test("weatherParameterToParams: omits the default, clears ?ws, preserves the rest", () => {
  const prev = p("ws=00433&c=51,10&z=6&y=2024");
  const out = weatherParameterToParams(WEATHER_PARAMETERS.PRECIPITATION_ANNUAL, prev);
  assert.equal(out.get("wp"), WEATHER_PARAMETERS.PRECIPITATION_ANNUAL);
  assert.equal(out.get("ws"), null, "station cleared so the nearest re-seeds");
  assert.equal(out.get("c"), "51,10", "viewport preserved");
  assert.equal(out.get("y"), "2024", "year preserved");
  // The default parameter writes a clean URL (no ?wp), still clearing ?ws.
  const def = weatherParameterToParams(DEFAULT_WEATHER_PARAM, p("ws=00433&c=51,10"));
  assert.equal(def.get("wp"), null);
  assert.equal(def.get("ws"), null);
  assert.equal(def.get("c"), "51,10");
});

Deno.test("weatherStationToParams: sets/clears ?ws, preserves the rest", () => {
  const prev = p("wp=foo&c=51,10");
  assert.equal(weatherStationToParams("00433", prev).get("ws"), "00433");
  assert.equal(weatherStationToParams("00433", prev).get("c"), "51,10");
  assert.equal(weatherStationToParams(null, p("ws=00433&wp=foo")).get("ws"), null);
  assert.equal(weatherStationToParams(null, p("ws=00433&wp=foo")).get("wp"), "foo");
});
