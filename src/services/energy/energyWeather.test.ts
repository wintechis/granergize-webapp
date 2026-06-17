/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  alignEnergyWeather,
  hasOverlap,
  type OverlayPoint,
  type WeatherAnnualValue,
  weatherByYear,
} from "./energyWeather.ts";

Deno.test("weatherByYear takes the year off each ISO date", () => {
  const values: WeatherAnnualValue[] = [
    { date: "2021-06-15T00:00:00Z", value: 10.5 },
    { date: "2022-06-15T00:00:00Z", value: 11.2 },
  ];
  const m = weatherByYear(values);
  assert.equal(m.get(2021), 10.5);
  assert.equal(m.get(2022), 11.2);
  assert.equal(m.size, 2);
});

Deno.test("weatherByYear: last value wins for a duplicated year", () => {
  const m = weatherByYear([
    { date: "2021-01-01", value: 9 },
    { date: "2021-07-01", value: 12 },
  ]);
  assert.equal(m.get(2021), 12);
});

Deno.test("weatherByYear drops non-finite values and dates", () => {
  const m = weatherByYear([
    { date: "2021-01-01", value: Number.NaN },
    { date: "not-a-date", value: 10 },
    { date: "2022-01-01", value: 8 },
  ]);
  assert.equal(m.has(2021), false);
  assert.equal(m.has(2022), true);
  assert.equal(m.size, 1);
});

Deno.test("alignEnergyWeather unions years, sorted ascending", () => {
  const energy = new Map([
    [2022, 100],
    [2020, 90],
  ]);
  const weather = new Map([
    [2021, 11],
    [2020, 10],
  ]);
  const points = alignEnergyWeather(energy, weather);
  assert.deepEqual(
    points.map((p) => p.year),
    [2020, 2021, 2022],
  );
});

Deno.test("alignEnergyWeather: missing layer is null, not 0", () => {
  const energy = new Map([[2022, 100]]);
  const weather = new Map([[2021, 11]]);
  const points = alignEnergyWeather(energy, weather);
  const byYear = new Map(points.map((p) => [p.year, p]));
  // 2021: weather only
  assert.equal(byYear.get(2021)!.energy, null);
  assert.equal(byYear.get(2021)!.weather, 11);
  // 2022: energy only
  assert.equal(byYear.get(2022)!.energy, 100);
  assert.equal(byYear.get(2022)!.weather, null);
});

Deno.test("alignEnergyWeather keeps a real 0 distinct from a gap", () => {
  const energy = new Map([[2020, 0]]);
  const weather = new Map([[2020, 0]]);
  const points = alignEnergyWeather(energy, weather);
  assert.equal(points[0].energy, 0);
  assert.equal(points[0].weather, 0);
});

Deno.test("alignEnergyWeather: both empty → empty series", () => {
  assert.deepEqual(alignEnergyWeather(new Map(), new Map()), []);
});

Deno.test("hasOverlap true only when a year carries both layers", () => {
  const overlap: OverlayPoint[] = [
    { year: 2020, energy: 90, weather: null },
    { year: 2021, energy: 100, weather: 11 },
  ];
  assert.equal(hasOverlap(overlap), true);

  const disjoint: OverlayPoint[] = [
    { year: 2020, energy: 90, weather: null },
    { year: 2021, energy: null, weather: 11 },
  ];
  assert.equal(hasOverlap(disjoint), false);

  assert.equal(hasOverlap([]), false);
});

Deno.test("end-to-end: adapter values + energy years align", () => {
  const weather = weatherByYear([
    { date: "2020-01-01", value: 10.1 },
    { date: "2021-01-01", value: 11.3 },
    { date: "2022-01-01", value: 10.8 },
  ]);
  const energy = new Map([
    [2021, 1200],
    [2022, 1150],
  ]);
  const points = alignEnergyWeather(energy, weather);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { year: 2020, energy: null, weather: 10.1 });
  assert.deepEqual(points[1], { year: 2021, energy: 1200, weather: 11.3 });
  assert.deepEqual(points[2], { year: 2022, energy: 1150, weather: 10.8 });
  assert.equal(hasOverlap(points), true);
});
