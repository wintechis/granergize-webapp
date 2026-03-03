import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
  AggregationType,
  EnergyType,
  EnergyCategoryKey,
} from "../../../types/types.ts";
import { getViewDefinition, storeComputedSnapshot } from "./viewManager.ts";
import { parseEnergyData } from "../utils/energyDataParser.ts";

const { namedNode } = DataFactory;

const VOCAB_PREFIX = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";

/**
 * Load energy data for a single building
 */
async function loadBuildingEnergyData(
  buildingUri: string,
  session: Session
): Promise<EnergyType | null> {
  buildingUri = buildingUri.split('#')[0];
  try {
    // Fetch building data to get energy data location
    const buildingResponse = await session.fetch(buildingUri);
    if (!buildingResponse.ok) {
      console.warn(`Could not fetch building ${buildingUri}: ${buildingResponse.status}`);
      return null;
    }

    const buildingText = await buildingResponse.text();
    const buildingParser = new Parser({ format: "text/turtle", baseIRI: buildingUri });
    const buildingQuads = buildingParser.parse(buildingText);
    const buildingStore = new Store(buildingQuads);

    // Extract building ID from URI
    const buildingId = buildingUri.split("/").pop()?.replace(".ttl", "") || "0";
    const buildingNode = namedNode(`${buildingUri}#${buildingId}`);

    // Find energy measurement data location
    const energyDataPredicate = namedNode(`${VOCAB_PREFIX}hasEnergyMeasurementData`);
    const datasetLocationPredicate = namedNode(`${VOCAB_PREFIX}datasetLocation`);

    const energyDataQuads = buildingStore.getQuads(
      buildingNode,
      energyDataPredicate,
      null,
      null
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
      null
    );

    if (locationQuads.length === 0) {
      console.warn(`No dataset location found for building ${buildingUri}`);
      return null;
    }

    const energyDataUrl = locationQuads[0].object.value;

    // Fetch energy data
    const energyResponse = await session.fetch(energyDataUrl);
    if (!energyResponse.ok) {
      console.warn(`Could not fetch energy data ${energyDataUrl}: ${energyResponse.status}`);
      return null;
    }

    const energyText = await energyResponse.text();
    const energyParser = new Parser({ format: "text/turtle", baseIRI: energyDataUrl });
    const energyQuads = energyParser.parse(energyText);

    return parseEnergyData(buildingId, energyDataUrl, energyQuads);
  } catch (error) {
    console.error(`Error loading energy data for building ${buildingUri}:`, error);
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
  metric: string
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
    const categoryData = energyData[category] as Record<string, number | undefined>;
    if (categoryData && typeof categoryData[metric] === "number") {
      return categoryData[metric] as number;
    }
  }

  return null;
}

/**
 * Compute aggregated values for a view definition
 */
export async function computeAggregation(
  session: Session,
  viewDefinition: AggregatedViewDefinition
): Promise<AggregatedViewSnapshot> {
  const { id, name, buildingUris, aggregationType, metrics } = viewDefinition;

  // Load energy data for all buildings
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
  viewId: string
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
 */
export async function refreshSnapshot(
  session: Session,
  viewId: string
): Promise<{ snapshot: AggregatedViewSnapshot; snapshotUrl: string }> {
  return computeAndStoreSnapshot(session, viewId);
}

/**
 * Get available metrics from energy data categories
 * This returns a list of common energy metrics that can be aggregated
 */
export function getAvailableMetrics(): { category: string; metrics: string[] }[] {
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
