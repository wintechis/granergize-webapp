/**
 * Whether a dataset's declared `gran:granularity` (xsd:duration) is a sub-hourly
 * *series* — large, fetched lazily on demand — vs. an *aggregate* (monthly/annual)
 * that's small enough to bulk-load. Drives the load strategy independently of the
 * producer's role. Sub-hourly = a time-only ISO-8601 duration with minutes/hours
 * (`PT…M` / `PT…H`); anything with a date part (`P…Y/M/W/D`) is an aggregate.
 * Returns false for absent/unparseable values (treat as aggregate — bulk-load).
 */
export function isSeriesGranularity(granularity?: string): boolean {
  if (!granularity) return false;
  const m = /^PT(?:\d+H)?(?:(\d+)M)?/.exec(granularity);
  if (!granularity.startsWith("PT")) return false; // has a date part ⇒ aggregate
  // PT-prefixed (time-only) durations are sub-hourly series (minutes/hours).
  return m !== null;
}
