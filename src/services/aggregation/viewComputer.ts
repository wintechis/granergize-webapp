import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { GRAN_NS } from "../utils/vocabularies.ts";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
  AggregationType,
  BuildingType,
  EnergyCategoryKey,
  EnergyType,
  InvestorAnnualData,
} from "../../../types/types.ts";
import { getViewDefinition, storeComputedSnapshot } from "./viewManager.ts";
import { parseEnergyData } from "../utils/energyDataParser.ts";
import { parseTtlReadings } from "../utils/userEnergyParser.ts";

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
    const buildingResponse = await session.fetch(buildingUri);
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

    // Extract building ID from URI
    const buildingId = buildingUri.split("/").pop()?.replace(".ttl", "") || "0";
    const buildingNode = namedNode(`${buildingUri}#${buildingId}`);

    // Find energy measurement data location
    const energyDataPredicate = namedNode(
      `${VOCAB_PREFIX}hasEnergyMeasurementData`,
    );
    const datasetLocationPredicate = namedNode(
      `${VOCAB_PREFIX}datasetLocation`,
    );

    const energyDataQuads = buildingStore.getQuads(
      buildingNode,
      energyDataPredicate,
      null,
      null,
    );

    if (energyDataQuads.length === 0) {
      console.warn(`No energy data found for building ${buildingUri}`);
      return null;
    }

    // Get the dataset location from the blank node
    const blankNode = energyDataQuads[0].object;
    const locationQuads = buildingStore.getQuads(
      blankNode,
      datasetLocationPredicate,
      null,
      null,
    );

    if (locationQuads.length === 0) {
      console.warn(`No dataset location found for building ${buildingUri}`);
      return null;
    }

    const energyDataUrl = locationQuads[0].object.value;

    // Fetch energy data
    const energyResponse = await session.fetch(energyDataUrl);
    if (!energyResponse.ok) {
      console.warn(
        `Could not fetch energy data ${energyDataUrl}: ${energyResponse.status}`,
      );
      return null;
    }

    const energyText = await energyResponse.text();
    const energyParser = new Parser({
      format: "text/turtle",
      baseIRI: energyDataUrl,
    });
    const energyQuads = energyParser.parse(energyText);

    return parseEnergyData(buildingId, energyDataUrl, energyQuads);
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
    const buildingResponse = await session.fetch(cleanUri);
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

    const buildingId = cleanUri.split("/").pop()?.replace(".ttl", "") || "0";
    const buildingNode = namedNode(`${cleanUri}#${buildingId}`);

    const datasetPredicate = namedNode(
      `${VOCAB_PREFIX}hasEnergyConsumptionDataset`,
    );
    const locationPredicate = namedNode(`${VOCAB_PREFIX}datasetLocation`);

    const datasetQuads = buildingStore.getQuads(
      buildingNode,
      datasetPredicate,
      null,
      null,
    );
    if (datasetQuads.length === 0) {
      console.warn(
        `No energy consumption dataset found for building ${cleanUri}`,
      );
      return null;
    }

    // Collect all datasetLocation URLs
    const allUrls: string[] = [];
    for (const dq of datasetQuads) {
      const locQuads = buildingStore.getQuads(
        dq.object,
        locationPredicate,
        null,
        null,
      );
      for (const lq of locQuads) {
        allUrls.push(lq.object.value);
      }
    }

    // Filter to URLs for the requested period (e.g., "2024-03")
    const periodUrls = allUrls.filter((url) => url.includes(period));
    if (periodUrls.length === 0) {
      console.warn(`No data for period ${period} in building ${cleanUri}`);
      return null;
    }

    // Fetch each daily file and sum all readings
    const settled = await Promise.allSettled(
      periodUrls.map((url) =>
        parseTtlReadings(url, session.fetch.bind(session))
      ),
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
 * Compute aggregated values for a view definition
 */
export async function computeAggregation(
  session: Session,
  viewDefinition: AggregatedViewDefinition,
  buildings?: BuildingType[],
): Promise<AggregatedViewSnapshot> {
  const { id, name, buildingUris, aggregationType, metrics, period } =
    viewDefinition;

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
    };

    return snapshot;
  }

  // BSP path: aggregate from pre-parsed annualData (no network fetch needed)
  if (buildings && buildings.length > 0) {
    const selectedBuildings = buildings.filter((b) =>
      buildingUris.includes(b.uri as string)
    );
    const metricValues: Record<string, number[]> = {};
    for (const b of selectedBuildings) {
      const annualData = (b.annualData ?? []) as InvestorAnnualData[];
      if (annualData.length === 0) continue;
      // Use most recent year
      const latest = annualData[annualData.length - 1];
      for (const metric of metrics) {
        const val = latest[metric as keyof InvestorAnnualData];
        if (typeof val === "number") {
          if (!metricValues[metric]) metricValues[metric] = [];
          metricValues[metric].push(val);
        }
      }
    }
    const aggregatedValues: Record<string, number> = {};
    for (const [metric, vals] of Object.entries(metricValues)) {
      if (vals.length > 0) {
        aggregatedValues[metric] = aggregateValues(vals, aggregationType);
      }
    }
    const buildingCount = selectedBuildings.filter((b) => {
      const ad = (b.annualData ?? []) as InvestorAnnualData[];
      return ad.length > 0;
    }).length;
    return {
      id,
      name,
      aggregationType,
      metrics,
      computedAt: new Date().toISOString(),
      buildingCount,
      values: aggregatedValues,
    };
  }

  // Standard path: categorical annual energy metrics
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
  };

  return snapshot;
}

/**
 * Compute and store a snapshot for a view
 */
export async function computeAndStoreSnapshot(
  session: Session,
  viewId: string,
  buildings?: BuildingType[],
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  const viewDefinition = await getViewDefinition(session, viewId);

  if (!viewDefinition) {
    throw new Error(`View definition not found: ${viewId}`);
  }

  const snapshot = await computeAggregation(session, viewDefinition, buildings);
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
