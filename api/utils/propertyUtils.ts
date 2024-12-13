// utils/propertyUtils.ts
export function getPropertyCategory(property: string): string {
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
      return category;
    }
  }

  throw new Error(`Unknown property: ${property}`);
}