/// <reference lib="deno.ns" />
// Tier-1: the user-energy chart's URI resolver (tab slug↔index, omit-default,
// preserve-rest for the day/month pickers).
import { strict as assert } from "node:assert";
import {
  resolveSeriesDay,
  resolveSeriesMonth,
  resolveSeriesTab,
  resolveSeriesTabIndex,
  seriesDayToParams,
  seriesMonthToParams,
  seriesTabToParams,
} from "./seriesChartParams.ts";

const p = (q: string) => new URLSearchParams(q);

Deno.test("resolveSeriesTab(Index): absent/unknown → day (0); known slug → itself", () => {
  assert.equal(resolveSeriesTab(p("")), "day");
  assert.equal(resolveSeriesTabIndex(p("")), 0);
  assert.equal(resolveSeriesTab(p("tab=bogus")), "day");
  assert.equal(resolveSeriesTab(p("tab=calendar")), "calendar");
  assert.equal(resolveSeriesTabIndex(p("tab=profile")), 2);
});

Deno.test("seriesTabToParams: omits the default, sets the rest, preserves day/month", () => {
  const prev = p("day=2024-03-15&month=2024-03&c=51,10");
  const out = seriesTabToParams(3, prev); // calendar
  assert.equal(out.get("tab"), "calendar");
  assert.equal(out.get("day"), "2024-03-15", "day preserved");
  assert.equal(out.get("month"), "2024-03", "month preserved");
  assert.equal(out.get("c"), "51,10", "viewport preserved");
  // index 0 (day) writes a clean URL (no ?tab)
  const def = seriesTabToParams(0, p("day=2024-03-15"));
  assert.equal(def.get("tab"), null);
  assert.equal(def.get("day"), "2024-03-15");
});

Deno.test("series day/month: read + set/clear, preserving the rest", () => {
  assert.equal(resolveSeriesDay(p("")), null);
  assert.equal(resolveSeriesDay(p("day=2024-03-15")), "2024-03-15");
  assert.equal(resolveSeriesMonth(p("month=2024-03")), "2024-03");

  const prev = p("tab=totals&month=2024-03");
  assert.equal(seriesDayToParams("2024-05-01", prev).get("day"), "2024-05-01");
  assert.equal(seriesDayToParams("2024-05-01", prev).get("tab"), "totals");
  assert.equal(seriesMonthToParams(null, p("month=2024-03&tab=totals")).get("month"), null);
  assert.equal(seriesMonthToParams(null, p("month=2024-03&tab=totals")).get("tab"), "totals");
});
