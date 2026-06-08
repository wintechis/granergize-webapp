import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { GRAN_NS } from "../utils/vocabularies.ts";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
  AggregationType,
  EnergyCategoryKey,
  EnergyDatasetRef,
  EnergyType,
} from "../../types.ts";
import { getViewDefinition, storeComputedSnapshot } from "./viewManager.ts";
import { fetchFresh } from "../utils/podFetch.ts";
import { listDirectChildren } from "../utils/podDelete.ts";
import {
  loadEnergyDatasets,
  parseDatasetSlug,
} from "../utils/energyDataset.ts";
import { isSeriesGranularity } from "../utils/durationUtils.ts";
import { parseTtlReadings } from "../utils/userEnergyParser.ts";
import { getSharedWithMe } from "../interop/sharingManager.ts";

const { namedNode } = DataFactory;

const VOCAB_PREFIX = GRAN_NS;

/**
 * Load energy data for a single building
 */
async function loadBuildingEnergyData(
  buildingUri: string,
  session: Session,
): Promise<EnergyType | null> {
  buildingUri = buildingUri.split("#")[0];
  try {
    // Fetch building data to get energy data location
    const buildingResponse = await fetchFresh(buildingUri, session);
    if (!buildingResponse.ok) {
      console.warn(
        `Could not fetch building ${buildingUri}: ${buildingResponse.status}`,
      );
      return null;
    }

    const buildingText = await buildingResponse.text();
    const buildingParser = new Parser({
      format: "text/turtle",
      baseIRI: buildingUri,
    });
    const buildingQuads = buildingParser.parse(buildingText);
    const buildingStore = new Store(buildingQuads);

    // Discover the building's annual datasets from its gran:hasEnergyDataset
    // links and load the latest actual year; its metrics become the energyNeed
    // (keyed by the AnnualMetrics names the view metrics use).
    const buildingId = buildingUri.split("/").pop()?.replace(".ttl", "") || "0";
    const annual = buildingStore
      .getObjects(null, namedNode(`${VOCAB_PREFIX}hasEnergyDataset`), null)
      .map((o) => parseDatasetSlug(o.value))
      .filter((r): r is EnergyDatasetRef =>
        r !== null && r.scenario === "actual" &&
        !isSeriesGranularity(r.granularity)
      );
    if (annual.length === 0) {
      console.warn(`No annual energy datasets for building ${buildingUri}`);
      return null;
    }
    const latest = annual.reduce((a, b) => (a.year >= b.year ? a : b));
    const [ds] = await loadEnergyDatasets([latest], session.fetch.bind(session));
    if (!ds?.metrics) return null;

    return {
      id: Number(buildingId) || 0,
      uri: `${buildingUri}#${buildingId}`,
      energyNeed: { ...ds.metrics },
      energyGeneration: {},
      energyStorage: {},
      energyDistribution: {},
      energyTransfer: {},
      energyUsage: {},
      environmentalFactor: {},
    } as EnergyType;
  } catch (error) {
    console.error(
      `Error loading energy data for building ${buildingUri}:`,
      error,
    );
    return null;
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
 * Load the total electricity consumption (kWh) for a user-role building for a given month.
 * Returns null if the building or data cannot be loaded.
 */
async function loadUserBuildingMonthlyTotal(
  buildingUri: string,
  period: string,
  session: Session,
): Promise<number | null> {
  const cleanUri = buildingUri.split("#")[0];
  try {
    const buildingResponse = await fetchFresh(cleanUri, session);
    if (!buildingResponse.ok) {
      console.warn(
        `Could not fetch building ${cleanUri}: ${buildingResponse.status}`,
      );
      return null;
    }

    const buildingText = await buildingResponse.text();
    const buildingParser = new Parser({
      format: "text/turtle",
      baseIRI: cleanUri,
    });
    const buildingQuads = buildingParser.parse(buildingText);
    const buildingStore = new Store(buildingQuads);

    // Series datasets locate their daily files in a container; list each and
    // sum the readings of the days within the requested period (e.g. "2024-03").
    const seriesRefs = buildingStore
      .getObjects(null, namedNode(`${VOCAB_PREFIX}hasEnergyDataset`), null)
      .map((o) => parseDatasetSlug(o.value))
      .filter((r): r is EnergyDatasetRef =>
        r !== null && isSeriesGranularity(r.granularity)
      );
    if (seriesRefs.length === 0) {
      console.warn(`No series energy datasets for building ${cleanUri}`);
      return null;
    }

    const dailyUrls: string[] = [];
    for (const ref of seriesRefs) {
      const container = ref.url.split("#")[0].replace(/\.ttl$/, "/");
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
 * Options marking a computed snapshot as a benchmark result — set by the BSP
 * compute-and-share flow so the snapshot is additionally a bench:BenchmarkResult
 * carrying the computing agent and the period covered.
 */
export interface BenchmarkOptions {
  benchmark?: boolean;
  metricPeriod?: string; // year the metrics cover, e.g. "2024"
}

/**
 * Compute aggregated values for a view definition
 */
export async function computeAggregation(
  session: Session,
  viewDefinition: AggregatedViewDefinition,
  opts: BenchmarkOptions = {},
): Promise<AggregatedViewSnapshot> {
  const { id, name, buildingUris, aggregationType, metrics, period } =
    viewDefinition;
  const benchmarkFields = opts.benchmark
    ? {
      isBenchmark: true as const,
      computedBy: session.info.webId,
      ...(opts.metricPeriod ? { metricPeriod: opts.metricPeriod } : {}),
    }
    : {};

  // User-role path: aggregate monthly electricity totals per building
  if (period) {
    const monthlyTotals: number[] = [];
    for (const buildingUri of buildingUris) {
      const total = await loadUserBuildingMonthlyTotal(
        buildingUri,
        period,
        session,
      );
      if (total !== null) {
        monthlyTotals.push(total);
      }
    }

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
      ...benchmarkFields,
    };

    return snapshot;
  }

  // Annual path: each building's latest annual dataset, aggregated per metric.
  const energyDataResults: EnergyType[] = [];

  for (const buildingUri of buildingUris) {
    const energyData = await loadBuildingEnergyData(buildingUri, session);
    if (energyData) {
      energyDataResults.push(energyData);
    }
  }

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
    ...benchmarkFields,
  };

  return snapshot;
}

/**
 * Compute and store a snapshot for a view
 */
export async function computeAndStoreSnapshot(
  session: Session,
  viewId: string,
  opts: BenchmarkOptions = {},
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  const viewDefinition = await getViewDefinition(session, viewId);

  if (!viewDefinition) {
    throw new Error(`View definition not found: ${viewId}`);
  }

  const snapshot = await computeAggregation(session, viewDefinition, opts);
  const snapshotUrl = await storeComputedSnapshot(session, snapshot);

  return { snapshot, snapshotUrl };
}

/**
 * Refresh (recompute) an existing view snapshot
 */
export async function refreshSnapshot(
  session: Session,
  viewId: string,
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  return computeAndStoreSnapshot(session, viewId);
}

/**
 * Get available metrics from energy data categories
 * This returns a list of common energy metrics that can be aggregated
 */
export function getAvailableMetrics(): {
  category: string;
  metrics: string[];
}[] {
  return [
    {
      category: "Energy Need",
      metrics: [
        "gas",
        "electricity",
        "gridSupply",
        "solar",
        "solarSpaceHeating",
        "photovoltaic",
        "selfConsumption",
        "gridFeedIn",
        "hallHeatingFromWasteLoss",
        "frostProtectionHBWFromWasteLoss",
        "ambientHeat",
        "ventilationHeat",
        "personHeat",
        "groundwater",
        "woodChips",
      ],
    },
    {
      category: "Energy Generation",
      metrics: [
        "hallLighting",
        "heatGeneration",
        "HbwHeat",
        "hallHeat",
      ],
    },
    {
      category: "Energy Storage",
      metrics: [
        "forkliftBatteryCharging",
        "heatStorage",
      ],
    },
    {
      category: "Energy Distribution",
      metrics: [
        "heatDistribution",
        "intralogisticsHallDistribution",
        "intralogisticsHbwDistribution",
        "hallHeatDistribution",
        "HbwHeatDistribution",
      ],
    },
    {
      category: "Energy Transfer",
      metrics: [
        "intralogisticsHallTransfer",
        "intralogisticsHbwTransfer",
        "hallHeatTransfer",
        "HbwHeatTransfer",
        "heatTransfer",
        "ForkliftTransfer",
      ],
    },
    {
      category: "Energy Usage",
      metrics: [
        "hallSpaceHeating",
        "work",
        "HbwFrostProtection",
      ],
    },
    {
      category: "Environmental Factor",
      metrics: [
        "cold",
      ],
    },
  ];
}

/**
 * Get available metrics for the Investor role (reads from building.annualData)
 */
export function getAvailableInvestorAnnualMetrics(): {
  category: string;
  metrics: string[];
}[] {
  return [
    {
      category: "Annual Consumption",
      metrics: [
        "electricityConsumption",
        "heatConsumption",
        "waterConsumption",
      ],
    },
    {
      category: "Renewable Generation",
      metrics: [
        "renewableSelfGeneratedShare",
      ],
    },
  ];
}

/**
 * Get available metrics for the BSP role (reads from building.annualData)
 */
export function getAvailableBspMetrics(): {
  category: string;
  metrics: string[];
}[] {
  return [
    {
      category: "Annual Consumption",
      metrics: [
        "electricityConsumption",
        "heatConsumption",
        "waterConsumption",
        "wastewaterConsumption",
      ],
    },
  ];
}

/** The roster a BSP benchmarks over: the buildings shared *to* it. */
export interface BspContributors {
  buildingUris: string[]; // the contributing buildings (shared to the BSP)
  contributors: string[]; // distinct WebIDs that shared them (the share-back targets)
}

/**
 * Pure fold of a shared-with-me roster into the benchmark's building list + the
 * distinct sharer WebIDs (the share-back targets). Split out from
 * {@link bspContributorBuildings} so it can be unit-tested without fixturing the
 * whole shared-in event fold. "Unknown" sharers (an event with no owner) are
 * dropped from the contributor set but their building is still benchmarked.
 */
export function summarizeContributors(
  shared: { buildingUri: string; sharedBy: string }[],
): BspContributors {
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
 * the current user (the BSP). The aggregation engine works over an explicit
 * building list; this folds the existing shared-with-me roster into that list and
 * collects the distinct sharer WebIDs as the share-back targets. Received buildings
 * carry the *sharer's* provenance, not benchmark_service_provider — so the BSP
 * create-view flow sources candidates here rather than from the owned-building
 * provenance filter.
 */
export async function bspContributorBuildings(
  session: Session,
): Promise<BspContributors> {
  return summarizeContributors(await getSharedWithMe(session));
}
