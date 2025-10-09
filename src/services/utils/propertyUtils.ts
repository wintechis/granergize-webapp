// utils/propertyUtils.ts
import type { EnergyCategoryKey } from "../../../types/types.ts";

export function getPropertyCategory(property: string): EnergyCategoryKey {
  const categories: { [key: string]: string[] } = {
    energyNeed: [
      "gas", "electricity", "gridSupply", "solar", "solarSpaceHeating",
      "photovoltaic", "selfConsumption", "gridFeedIn", "hallHeatingFromWasteLoss",
      "frostProtectionHbwFromWasteLoss", "ambientHeat", "ventilationHeat", "personHeat",
      "groundwater", "woodChips"
    ],
    energyGeneration: [
      "hallLighting", "heatGeneration", "hbwHeat", "hallHeat"
    ],
    energyStorage: [
      "forkliftBatteryCharging", "heatStorage"
    ],
    energyDistribution: [
      "heatDistribution", "intralogisticsHallDistribution", "intralogisticsHbwDistribution",
      "hallHeatDistribution", "hbwHeatDistribution"
    ],
    energyTransfer: [
      "intralogisticsHallTransfer", "intralogisticsHbwTransfer", "hallHeatTransfer",
      "hbwHeatTransfer", "heatTransfer", "forkliftTransfer"
    ],
    energyUsage: [
      "hallSpaceHeating", "work", "hbwFrostProtection"
    ],
    environmentalFactor: [
      "cold"
    ],
  };

  for (const [category, properties] of Object.entries(categories)) {
    if (properties.includes(property)) {
      return category as EnergyCategoryKey;
    }
  }

  throw new Error(`Unknown property: ${property}`);
}