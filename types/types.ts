export type UserRole =
  | "dummy"
  | "investor"
  | "user"
  | "benchmark_service_provider";

export interface InvestorAnnualData {
  year: number;
  electricityConsumption?: number; // kWh
  renewableSelfGeneratedShare?: number; // %
  heatConsumption?: number; // kWh
  waterConsumption?: number; // m³
  wastewaterConsumption?: number; // m³
}

export interface InvestorOperatingCosts {
  wasteDisposal?: string;
  insurance?: string;
  operationInspectionAndMaintenance?: boolean;
  routineCleaningOffice?: string;
  routineCleaningWarehouse?: string;
  glassCleaning?: string;
  exteriorMaintenance?: string;
  security?: string;
  propertyManagement?: string;
  caretaker?: string;
  repairAndMaintenance?: string;
}

export interface InvestorCertification {
  type: string; // "BREEAM" | "DGNB" | "LEED"
  level?: string;
  scope?: string;
}

export interface BuildingType {
  [key: string]:
    | string
    | number
    | boolean
    | EnergyMeasurementData[]
    | InvestorAnnualData[]
    | InvestorCertification[]
    | InvestorOperatingCosts
    | undefined;
  id: number;
  uri: string;
  sourceUri?: string;
  type: string;
  customer?: string;
  energyCertificate?: string;
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
  isShared?: boolean;
  // BSP role fields
  logisticsFunction?: string;
  climateControlType?: string;
  greenLeaseShare?: number; // %
  indoorTemperature?: string;
  pvInstallationYear?: number;
  pvCapacityKW?: number;
  companyName?: string;
  // Investor role fields
  label?: string;
  buildingCode?: string;
  hallArea?: number;
  officeSocialArea?: number;
  buildingHeight?: number;
  numberOfLoadingDocks?: number;
  yearOfRenovation?: number;
  shiftRegime?: string;
  tenancyType?: string;
  leaseType?: string;
  tenantIndustry?: string;
  indoorTemperatureClass?: string;
  hasOilBoiler?: boolean;
  hasGasBoiler?: boolean;
  hasElectricBoiler?: boolean;
  hasHeatPump?: boolean;
  hasDistrictHeating?: boolean;
  certifications?: InvestorCertification[];
  annualData?: InvestorAnnualData[];
  operatingCosts?: InvestorOperatingCosts;
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
  /** Populated only for the User role: ordered 15-minute electricity readings */
  timeSeries?: {
    electricityConsumption: Array<{ begin: string; value: number }>;
  };
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

// Aggregated View types
export type AggregationType = "average" | "sum" | "min" | "max";

export interface AggregatedViewDefinition {
  id: string;
  name: string;
  buildingUris: string[]; // Private - not included in shared snapshots
  aggregationType: AggregationType;
  metrics: string[]; // e.g., ["gas", "electricity", "solar"]
  createdAt: string; // ISO timestamp
  lastComputedAt?: string; // ISO timestamp of last snapshot computation
  period?: string; // "YYYY-MM" — set for user-role electricity views
}

export interface AggregatedViewSnapshot {
  id: string;
  name: string;
  aggregationType: AggregationType;
  metrics: string[];
  computedAt: string;
  buildingCount: number; // How many buildings were aggregated (privacy-preserving)
  values: Record<string, number>; // metric name -> computed value
}

export interface SharedAggregatedView {
  viewUri: string;
  viewId: string;
  sharedWith: string[]; // WebIDs
}
