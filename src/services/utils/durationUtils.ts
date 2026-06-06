/**
 * Whether a dataset's declared `gran:granularity` (xsd:duration) is a sub-hourly
 * *series* — large, fetched lazily on demand — vs. an *aggregate* (monthly/annual)
 * that's small enough to bulk-load. Drives the load strategy independently of the
 * producer's role. Sub-hourly = a time-only ISO-8601 duration with minutes/hours
 * (`PT…M` / `PT…H`); anything with a date part (`P…Y/M/W/D`) is an aggregate.
 * Returns false for absent/unparseable values (treat as aggregate — bulk-load).
 */
export function isSeriesGranularity(granularity?: string): boolean {
  // A time-only ISO-8601 duration (`PT…`) is a sub-hourly series; anything with a
  // date part (`P…Y/M/W/D`) — or an absent/unparseable value — is an aggregate.
  return granularity?.startsWith("PT") ?? false;
}
