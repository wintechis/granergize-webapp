// Energy / consumption object model — datasets, the annual summary, and the rich
// logistics energy-category model. Reached via the `src/types.ts` barrel.
import type { EnergyDatasetFields } from "../services/rdf/consumptionShape.generated.ts";

export interface AnnualData {
  year: number;
  electricityConsumption?: number; // kWh
  renewableSelfGeneratedShare?: number; // %
  heatConsumption?: number; // kWh
  waterConsumption?: number; // m³
  wastewaterConsumption?: number; // m³
  electricityGeneration?: number; // kWh
}

/** Actual readings vs planned (Soll) figures, at the energy-dataset level. */
export type Scenario = "actual" | "planned";

/**
 * A reference to one `cons:EnergyDataset`, derived from a building's
 * `cons:hasEnergyDataset` link. Datasets are time-first under `observations/`
 * (`observations/{year}/{id}.ttl#ds`), so the link path yields the year; the
 * granularity and scenario are read from the triples the building re-states
 * about the dataset node (`cons:granularity`/`cons:scenario`) — so load can be
 * dispatched (series lazy, annual prefetched) without fetching the dataset. See
 * `services/rdf/energyDataset.ts`.
 */
export interface EnergyDatasetRef extends EnergyDatasetFields {
  /** The dataset node IRI (the linked `observations/{year}/{id}.ttl#ds`). */
  uri: string;
  year: number;
  // granularity / scenario ← EnergyDatasetFields (vocab-derived)
  /** The `sosa:hasFeatureOfInterest` the dataset observes, when a specific unit
   * (a `bldg:hasSystem` node, e.g. `<#pv>`) rather than the building as a whole.
   * Part of a dataset's identity, so a per-unit series doesn't collide with the
   * building's for the same (year, granularity, scenario). */
  featureOfInterest?: string;
}

export type EnergyType = {
  /** The owning building's id (see {@link BuildingType.id}). */
  id: string;
  uri: string;
  /** The annual year the figures cover (the latest accessible actual year). */
  year?: number;
  energyNeed: EnergyNeed;
  energyGeneration: EnergyGeneration;
  energyStorage: EnergyStorage;
  energyDistribution: EnergyDistribution;
  energyTransfer: EnergyTransfer;
  energyUsage: EnergyUsage;
  environmentalFactor: EnvironmentalFactor;
};

export type EnergyCategoryKey =
  | "energyNeed"
  | "energyGeneration"
  | "energyStorage"
  | "energyDistribution"
  | "energyTransfer"
  | "energyUsage"
  | "environmentalFactor";

type EnergyNeed = {
  [key: string]: number | undefined;
  gas?: number;
  electricity?: number;
  gridSupply?: number;
  solar?: number;
  solarSpaceHeating?: number;
  photovoltaic?: number;
  selfConsumption?: number;
  gridFeedIn?: number;
  hallHeatingFromWasteLoss?: number;
  frostProtectionHBWFromWasteLoss?: number;
  ambientHeat?: number;
  ventilationHeat?: number;
  personHeat?: number;
  groundwater?: number;
  woodChips?: number;
};

type EnergyGeneration = {
  [key: string]: number | undefined;
  hallLighting?: number;
  heatGeneration?: number;
  HbwHeat?: number;
  hallHeat?: number;
};

type EnergyStorage = {
  [key: string]: number | undefined;
  forkliftBatteryCharging?: number;
  heatStorage?: number;
};

type EnergyDistribution = {
  [key: string]: number | undefined;
  heatDistribution?: number;
  intralogisticsHallDistribution?: number;
  intralogisticsHbwDistribution?: number;
  hallHeatDistribution?: number;
  HbwHeatDistribution?: number;
};

type EnergyTransfer = {
  [key: string]: number | undefined;
  intralogisticsHallTransfer?: number;
  intralogisticsHbwTransfer?: number;
  hallHeatTransfer?: number;
  HbwHeatTransfer?: number;
  heatTransfer?: number;
  ForkliftTransfer?: number;
};

type EnergyUsage = {
  [key: string]: number | undefined;
  hallSpaceHeating?: number;
  work?: number;
  HbwFrostProtection?: number;
};

type EnvironmentalFactor = {
  [key: string]: number | undefined;
  cold?: number;
};
