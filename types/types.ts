export interface BuildingType {
  [key: string]:
    | string
    | number
    | boolean
    | EnergyMeasurementData[]
    | undefined;
  id: number;
  uri: string;
  type: string;
  customer?: string;
  lat?: number;
  long?: number;
  locality?: string;
  postalCode?: number;
  region?: string;
  streetAddress?: string;
  buildingArea?: number;
  landArea?: number;
  hasPVSystem?: boolean;
  investor?: string;
  officeArea?: number;
  usedAs?: string;
  yearOfConstruction?: number;
  naceCode?: number;
  operatedBy?: string;
  energyData?: EnergyMeasurementData[];
}

export interface EnergyMeasurementData {
  year: number;
  location: string;
  type: string;
}

export type AgentType = {
  id: string;
  type: string;
  name: string;
};

export type WeatherType = {
  id: string;
  sunshineDuration?: number;
};

export type EnergyType = {
  id: number;
  uri: string;
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

export type EnergyMix = {
  energyConsumption: EnergyConsumption;
  energyProduction: EnergyProduction;
};

export type EnergyConsumption = {
  value: number;
  renewableEnergyShare: number;
};

export type EnergyProduction = {
  hydroShare: number;
  windShare: number;
  solarShare: number;
  biomassShare: number;
  geothermalShare: number;
  hydroProduction: number;
  windProduction: number;
  solarProduction: number;
  biomassProduction: number;
  geothermalProduction: number;
  totalRenewableProduction: number;
};
