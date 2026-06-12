import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
  AggregationType,
  EnergyCategoryKey,
  EnergyType,
} from "../../types.ts";
import { getViewDefinition, storeComputedSnapshot } from "./viewManager.ts";
import { readStoreOrEmpty } from "../pod/podFetch.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import {
  loadEnergyDatasets,
  parseEnergyDatasetRefs,
} from "../rdf/energyDataset.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { parseTtlReadings } from "../rdf/userEnergyParser.ts";
import { getSharedWithMe } from "../interop/sharingManager.ts";
import {
  buildingFileUrl,
  buildingIdFor,
} from "../rdf/building/buildingId.ts";
import { getStorageRoot } from "../pod/solidUtils.ts";
import { mapPooled } from "../../lib/pool.ts";

/**
 * Load energy data for a single building. Returns the metrics of the latest
 * actual annual dataset plus the YEAR they cover (so a benchmark compute can
 * derive its bench:metricPeriod from the data it actually aggregated).
 */
async function loadBuildingEnergyData(
  buildingUri: string,
  session: Session,
): Promise<{ energy: EnergyType; year: number } | null> {
  // The view definition records the SUBJECT IRI; the document is its
  // fragment-free form. Carry the subject through verbatim — identity is the
  // IRI, never reconstructed from the file name.
  const fileUrl = buildingFileUrl(buildingUri);
  try {
    // Fetch building data to get energy data location (an unreadable building
    // degrades to an empty store, i.e. no datasets).
    const buildingStore = await readStoreOrEmpty(fileUrl, session);

    // Discover the building's annual datasets from its cons:hasEnergyDataset
    // links and load the latest actual year; its metrics become the energyNeed
    // (keyed by the AnnualMetrics names the view metrics use).
    const annual = parseEnergyDatasetRefs(buildingStore, null)
      .filter((r) =>
        r.scenario === "actual" && !isSeriesGranularity(r.granularity)
      );
    if (annual.length === 0) {
      console.warn(`No annual energy datasets for building ${fileUrl}`);
      return null;
    }
    const latest = annual.reduce((a, b) => (a.year >= b.year ? a : b));
    const [ds] = await loadEnergyDatasets([latest], session.fetch.bind(session));
    if (!ds?.metrics) return null;

    return {
      energy: {
        id: buildingIdFor(buildingUri, ownStorageRootOrUndefined(session)),
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
 * The session owner's storage root for id derivation, or undefined when the
 * cache isn't primed (headless callers) — ids then stay absolute, which the
 * two-shape id model treats as equivalent.
 */
function ownStorageRootOrUndefined(session: Session): string | undefined {
  try {
    return session.info.webId ? getStorageRoot(session.info.webId) : undefined;
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
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
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
  session: Session,
): Promise<number | null> {
  const cleanUri = buildingFileUrl(buildingUri);
  try {
    // An unreadable building degrades to an empty store, i.e. no datasets.
    const buildingStore = await readStoreOrEmpty(cleanUri, session);

    // Series datasets locate their daily files in a container; list each and
    // sum the readings of the days within the requested period (e.g. "2024-03").
    const seriesRefs = parseEnergyDatasetRefs(buildingStore, null)
      .filter((r) => isSeriesGranularity(r.granularity));
    if (seriesRefs.length === 0) {
      console.warn(`No series energy datasets for building ${cleanUri}`);
      return null;
    }

    const dailyUrls: string[] = [];
    for (const ref of seriesRefs) {
      const container = buildingFileUrl(ref.url).replace(/\.ttl$/, "/");
      const children = (await listDirectChildren(container, session)) ?? [];
      for (const url of children) {
        if (url.endsWith(".ttl") && url.includes(period)) dailyUrls.push(url);
      }
    }
    if (dailyUrls.length === 0) {
      console.warn(`No data for period ${period} in building ${cleanUri}`);
      return null;
    }

    const settled = await Promise.allSettled(
      dailyUrls.map((url) => parseTtlReadings(url, session.fetch.bind(session))),
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
 * Compute aggregated values for a view definition.
 *
 * A definition flagged `benchmark` yields a snapshot additionally typed
 * bench:BenchmarkResult, carrying the computing agent and the period covered.
 * The flag lives ON the definition (not in call-site options), so every
 * recompute — including a plain refresh — preserves the benchmark typing; the
 * covered year is derived from the data actually aggregated.
 * @operation query
 */
export async function computeAggregation(
  session: Session,
  viewDefinition: AggregatedViewDefinition,
): Promise<AggregatedViewSnapshot> {
  const { id, name, buildingUris, aggregationType, metrics, period, benchmark } =
    viewDefinition;
  const benchmarkFields = (metricPeriod?: string) =>
    benchmark
      ? {
        isBenchmark: true as const,
        computedBy: session.info.webId,
        ...(metricPeriod ? { metricPeriod } : {}),
      }
      : {};

  // Monthly path (data shape: a sub-hourly series): aggregate the period's
  // electricity totals per building. Bounded concurrency (mapPooled, the
  // Cloudflare-safe pattern viewManager uses) instead of strictly serial
  // round-trips — a 20-building view was 40+ sequential fetches.
  if (period) {
    const monthlyTotals = (await mapPooled(
      buildingUris,
      4,
      (buildingUri) => loadUserBuildingMonthlyTotal(buildingUri, period, session),
    )).filter((t): t is number => t !== null);

    const snapshot: AggregatedViewSnapshot = {
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
    (buildingUri) => loadBuildingEnergyData(buildingUri, session),
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

  const snapshot: AggregatedViewSnapshot = {
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
 * Compute and store a snapshot for a view. Benchmark typing comes from the
 * persisted definition (`benchmark` flag) — there are no call-site options.
 * @operation mutation
 */
export async function computeAndStoreSnapshot(
  session: Session,
  viewId: string,
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  const viewDefinition = await getViewDefinition(session, viewId);

  if (!viewDefinition) {
    throw new Error(`View definition not found: ${viewId}`);
  }

  const snapshot = await computeAggregation(session, viewDefinition);
  const snapshotUrl = await storeComputedSnapshot(session, snapshot);

  return { snapshot, snapshotUrl };
}

/**
 * Refresh (recompute) an existing view snapshot
 * @operation mutation
 */
export async function refreshSnapshot(
  session: Session,
  viewId: string,
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  return computeAndStoreSnapshot(session, viewId);
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

/**
 * Populate the benchmark's building list from the roster of buildings shared *to*
 * the current user. The aggregation engine works over an explicit
 * building list; this folds the existing shared-with-me roster into that list and
 * collects the distinct sharer WebIDs as the share-back targets. These are buildings
 * owned by OTHERS (shared to this user), so the benchmark create-view flow sources its
 * candidates here rather than from the user's own buildings.
 * @operation query
 */
export async function sharedContributorBuildings(
  session: Session,
): Promise<Contributors> {
  return summarizeContributors(await getSharedWithMe(session));
}
