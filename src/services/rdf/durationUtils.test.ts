/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { isSeriesGranularity } from "./durationUtils.ts";

Deno.test("isSeriesGranularity: sub-hourly = series, dated = aggregate", () => {
  // Sub-hourly time-only durations → series (lazy-loaded).
  assert.ok(isSeriesGranularity("PT15M"));
  assert.ok(isSeriesGranularity("PT1H"));
  // Dated durations → aggregate (bulk-loaded).
  assert.equal(isSeriesGranularity("P1Y"), false);
  assert.equal(isSeriesGranularity("P1M"), false);
  // Absent/garbage → aggregate (safe default).
  assert.equal(isSeriesGranularity(undefined), false);
  assert.equal(isSeriesGranularity(""), false);
  assert.equal(isSeriesGranularity("nonsense"), false);
});
