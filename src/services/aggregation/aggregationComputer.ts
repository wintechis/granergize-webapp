import type { PodGateway } from "../pod/podGateway.ts";
import type {
  AggregationDefinition,
  AggregationSnapshot,
  AggregationType,
  BuildingType,
  EnergyCategoryKey,
  EnergyType,
} from "../../types.ts";
import { getAggregationDefinition, storeComputedSnapshot } from "./aggregationManager.ts";
import { readStoreOrEmpty } from "../pod/podFetch.ts";
import {
  type EnergyDatasetRef,
  listSeriesDays,
  loadEnergyDatasets,
  parseEnergyDatasetRefs,
} from "../rdf/energyDataset.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { parseTtlReadings } from "../rdf/userEnergyParser.ts";
import {
  buildingFileUri,
  buildingIdFor,
} from "../rdf/building/buildingId.ts";
import { getStorageRoot } from "../pod/solidUtils.ts";
import { mapPooled } from "../../lib/pool.ts";

/**
 * The building's `cons:hasEnergyDataset` refs from the WARM `useBuildings` cache,
 * or null when there's no client / the building isn't cached. The map parses these
 * refs reliably; re-reading the building file to re-derive them is the slow-Pod
 * flake that left fresh snapshots empty — so prefer the cache and only fall back to
 * a file read. Identity is the subject IRI (`building.uri`).
 */
function cachedBuildingRefs(buildingUri: string): EnergyDatasetRef[] | null {
  const qc = getAppQueryClient();
  if (!qc) return null;
  // Prefix-match the "buildings" query root (the WebID/fingerprint tail varies),
  // matching `queryKeys.buildings[0]` without importing the hooks layer.
  const entries = qc.getQueriesData<{ buildings: BuildingType[] }>({
    predicate: (q) => q.queryKey[0] === "buildings",
  });
  for (const [, data] of entries) {
    const b = data?.buildings.find((x) => x.uri === buildingUri);
    if (b) return b.energyDatasets ?? [];
  }
  return null;
}

/**
 * The building's energy-dataset refs: the warm-cache fast path, else a re-read of
 * the building file with a bounded retry. The aggregation's buildings exist (seeded well
 * before), so a transient empty read on a slow Pod is the flake to ride out —
 * `readStoreOrEmpty` swallows the distinction, so retry until refs appear or the
 * cap; a genuinely energy-less building just retries cheaply and returns nothing.
 */
async function resolveBuildingRefs(
  buildingUri: string,
  fileUri: string,
  gateway: PodGateway,
): Promise<EnergyDatasetRef[]> {
  const cached = cachedBuildingRefs(buildingUri);
  if (cached) return cached;
  for (let attempt = 0; attempt < 4; attempt++) {
    const refs = parseEnergyDatasetRefs(
      await readStoreOrEmpty(fileUri, gateway),
      null,
    );
    if (refs.length > 0 || attempt === 3) return refs;
    await new Promise((r) => setTimeout(r, 300));
  }
  return [];
}

/**
 * Load energy data for a single building. Returns the metrics of the latest
 * actual annual dataset plus the YEAR they cover (so a benchmark compute can
 * derive its bench:metricPeriod from the data it actually aggregated).
 */
async function loadBuildingEnergyData(
  buildingUri: string,
  gateway: PodGateway,
): Promise<{ energy: EnergyType; year: number } | null> {
  // The aggregation definition records the SUBJECT IRI; the document is its
  // fragment-free form. Carry the subject through verbatim — identity is the
  // IRI, never reconstructed from the file name.
  const fileUri = buildingFileUri(buildingUri);
  try {
    // Discover the building's annual datasets from its cons:hasEnergyDataset
    // links (warm cache, else a retrying file read) and load the latest actual
    // year; its metrics become the energyNeed (keyed by the AnnualMetrics names
    // the aggregation metrics use).
    const annual = (await resolveBuildingRefs(buildingUri, fileUri, gateway))
      .filter((r) =>
        r.scenario === "actual" && !isSeriesGranularity(r.granularity)
      );
    if (annual.length === 0) {
      console.warn(`No annual energy datasets for building ${fileUri}`);
      return null;
    }
    const latest = annual.reduce((a, b) => (a.year >= b.year ? a : b));
    const [ds] = await loadEnergyDatasets([latest], gateway.fetch.bind(gateway));
    if (!ds?.metrics) return null;

    return {
      energy: {
        id: buildingIdFor(buildingUri, ownStorageRootOrUndefined(gateway)),
        uri: buildingUri,
        energyNeed: { ...ds.metrics },
        energyGeneration: {},
        energyStorage: {},
        energyDistribution: {},
        energyTransfer: {},
        energyUsage: {},
        environmentalFactor: {},
      } as EnergyType,
      year: latest.year,
    };
  } catch (error) {
    console.error(
      `Error loading energy data for building ${buildingUri}:`,
      error,
    );
    return null;
  }
}

/**
 * The gateway owner's storage root for id derivation, or undefined when the
 * cache isn't primed (headless callers) — ids then stay absolute, which the
 * two-shape id model treats as equivalent.
 */
function ownStorageRootOrUndefined(gateway: PodGateway): string | undefined {
  try {
    return gateway.webId ? getStorageRoot(gateway.webId) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Aggregate values based on aggregation type
 */
function aggregateValues(values: number[], type: AggregationType): number {
  if (values.length === 0) return 0;

  switch (type) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * Extract metric values from energy data
 */
function extractMetricValue(
  energyData: EnergyType,
  metric: string,
): number | null {
  const categories: EnergyCategoryKey[] = [
    "energyNeed",
    "energyGeneration",
    "energyStorage",
    "energyDistribution",
    "energyTransfer",
    "energyUsage",
    "environmentalFactor",
  ];

  for (const category of categories) {
    const categoryData = energyData[category] as Record<
      string,
      number | undefined
    >;
    if (categoryData && typeof categoryData[metric] === "number") {
      return categoryData[metric] as number;
    }
  }

  return null;
}

/**
 * Load the total electricity consumption (kWh) of a series-shaped building for a given month.
 * Returns null if the building or data cannot be loaded.
 */
async function loadUserBuildingMonthlyTotal(
  buildingUri: string,
  period: string,
  gateway: PodGateway,
): Promise<number | null> {
  const cleanUri = buildingFileUri(buildingUri);
  try {
    // An unreadable building degrades to an empty store, i.e. no datasets.
    const buildingStore = await readStoreOrEmpty(cleanUri, gateway);

    // Series datasets locate their daily files in a container; list each and
    // sum the readings of the days within the requested period (e.g. "2024-03").
    const seriesRefs = parseEnergyDatasetRefs(buildingStore, null)
      .filter((r) => isSeriesGranularity(r.granularity));
    if (seriesRefs.length === 0) {
      console.warn(`No series energy datasets for building ${cleanUri}`);
      return null;
    }

    // Day chunks are time-first under each series' year container; list them
    // and keep the days whose `YYYY-MM-DD` falls in the requested period
    // (e.g. "2024-03" → days starting "2024-03").
    const dailyUris: string[] = [];
    for (const ref of seriesRefs) {
      const days = await listSeriesDays(gateway, ref);
      for (const { day, uri } of days) {
        if (day.startsWith(period)) dailyUris.push(uri);
      }
    }
    if (dailyUris.length === 0) {
      console.warn(`No data for period ${period} in building ${cleanUri}`);
      return null;
    }

    const settled = await Promise.allSettled(
      dailyUris.map((uri) => parseTtlReadings(uri, gateway.fetch.bind(gateway))),
    );

    let total = 0;
    let anySucceeded = false;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        total += result.value.reduce((s, r) => s + r.value, 0);
        anySucceeded = true;
      }
    }

    return anySucceeded ? total : null;
  } catch (error) {
    console.error(
      `Error loading user energy data for building ${buildingUri}:`,
      error,
    );
    return null;
  }
}

/**
 * Compute aggregated values for an aggregation definition.
 *
 * A definition flagged `benchmark` yields a snapshot additionally typed
 * bench:BenchmarkResult, carrying the computing agent and the period covered.
 * The flag lives ON the definition (not in call-site options), so every
 * recompute — including a plain refresh — preserves the benchmark typing; the
 * covered year is derived from the data actually aggregated.
 * @operation query
 */
export async function computeAggregation(
  gateway: PodGateway,
  aggregationDefinition: AggregationDefinition,
): Promise<AggregationSnapshot> {
  const { id, name, buildingUris, aggregationType, metrics, period, benchmark } =
    aggregationDefinition;
  const benchmarkFields = (metricPeriod?: string) =>
    benchmark
      ? {
        isBenchmark: true as const,
        computedBy: gateway.webId,
        ...(metricPeriod ? { metricPeriod } : {}),
      }
      : {};

  // Monthly path (data shape: a sub-hourly series): aggregate the period's
  // electricity totals per building. Bounded concurrency (mapPooled, the
  // Cloudflare-safe pattern aggregationManager uses) instead of strictly serial
  // round-trips — a 20-building aggregation was 40+ sequential fetches.
  if (period) {
    const monthlyTotals = (await mapPooled(
      buildingUris,
      4,
      (buildingUri) => loadUserBuildingMonthlyTotal(buildingUri, period, gateway),
    )).filter((t): t is number => t !== null);

    const snapshot: AggregationSnapshot = {
      id,
      name,
      aggregationType,
      metrics: ["electricity"],
      computedAt: new Date().toISOString(),
      buildingCount: monthlyTotals.length,
      values: monthlyTotals.length > 0
        ? { electricity: aggregateValues(monthlyTotals, aggregationType) }
        : {},
      // A monthly benchmark's covered period is the month itself.
      ...benchmarkFields(period),
    };

    return snapshot;
  }

  // Annual path: each building's latest annual dataset, aggregated per metric
  // (bounded concurrency, as above).
  const loadedAll = (await mapPooled(
    buildingUris,
    4,
    (buildingUri) => loadBuildingEnergyData(buildingUri, gateway),
  )).filter((l): l is { energy: EnergyType; year: number } => l !== null);
  const energyDataResults = loadedAll.map((l) => l.energy);
  const latestYear = loadedAll.length > 0
    ? Math.max(...loadedAll.map((l) => l.year))
    : undefined;

  // Compute aggregated values for each metric
  const aggregatedValues: Record<string, number> = {};

  for (const metric of metrics) {
    const values: number[] = [];

    for (const energyData of energyDataResults) {
      const value = extractMetricValue(energyData, metric);
      if (value !== null) {
        values.push(value);
      }
    }

    if (values.length > 0) {
      aggregatedValues[metric] = aggregateValues(values, aggregationType);
    }
  }

  const snapshot: AggregationSnapshot = {
    id,
    name,
    aggregationType,
    metrics,
    computedAt: new Date().toISOString(),
    buildingCount: energyDataResults.length,
    values: aggregatedValues,
    // The year the aggregated figures cover = the latest annual year actually
    // used (per-building latest, max across buildings) — derived, not stored,
    // so it stays truthful when a building gains a newer year.
    ...benchmarkFields(latestYear === undefined ? undefined : String(latestYear)),
  };

  return snapshot;
}

/**
 * Compute and store a snapshot for an aggregation. Benchmark typing comes from the
 * persisted definition (`benchmark` flag) — there are no call-site options.
 * @operation mutation
 */
export async function computeAndStoreSnapshot(
  gateway: PodGateway,
  aggregationId: string,
): Promise<{ snapshot: AggregationSnapshot; snapshotUri: string }> {
  const aggregationDefinition = await getAggregationDefinition(gateway, aggregationId);

  if (!aggregationDefinition) {
    throw new Error(`Aggregation definition not found: ${aggregationId}`);
  }

  const snapshot = await computeAggregation(gateway, aggregationDefinition);
  const snapshotUri = await storeComputedSnapshot(gateway, snapshot);

  return { snapshot, snapshotUri };
}

/**
 * Refresh (recompute) an existing aggregation snapshot
 * @operation mutation
 */
export async function refreshSnapshot(
  gateway: PodGateway,
  aggregationId: string,
): Promise<{ snapshot: AggregationSnapshot; snapshotUri: string }> {
  return computeAndStoreSnapshot(gateway, aggregationId);
}

/** The roster a benchmark aggregates over: the buildings shared *to* this user. */
export interface Contributors {
  buildingUris: string[]; // the contributing buildings (shared to this user)
  contributors: string[]; // distinct WebIDs that shared them (the share-back targets)
}

/**
 * Pure fold of a shared-with-me roster into the benchmark's building list + the
 * distinct sharer WebIDs (the share-back targets). Split out from
 * {@link sharedContributorBuildings} so it can be unit-tested without fixturing the
 * whole shared-in event fold. "Unknown" sharers (an event with no owner) are
 * dropped from the contributor set but their building is still benchmarked.
 */
export function summarizeContributors(
  shared: { buildingUri: string; sharedBy: string }[],
): Contributors {
  const buildingUris = [...new Set(shared.map((b) => b.buildingUri))];
  const contributors = [
    ...new Set(
      shared
        .map((b) => b.sharedBy)
        .filter((w) => w && w !== "Unknown"),
    ),
  ];
  return { buildingUris, contributors };
}
