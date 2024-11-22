export type BuildingType = {
    id: number;
    customer: string;
    type: string;
    lat: number;
    long: number;
    locality: string;
    "postal code": number;
    region: string;
    "street address": string;
    "building area": number;
    "land area": number;
    "has pv system": boolean;
    investor: string;
    "office area": number;
    "used as": string;
    "year of construction": number;
    "nace code": number;
    "operated by": string;
};

export type AgentType = {
    id: string;
    type: string;
    name: string;
};

export type EnergyType = {
    "id": number;
    "energyNeed": EnergyNeed;
    "energyGeneration": EnergyGeneration;
    "energyStorage": EnergyStorage;
    "energyDistribution": EnergyDistribution;
    "energyTransfer": EnergyTransfer;
    "energyUsage": EnergyUsage;
    "environmentalFactor": EnvironmentalFactor;
};

type EnergyNeed = {
    "gas"?: number;
    "electricity"?: number;
    "gridSupply"?: number;
    "solar"?: number;
    "solarSpaceHeating"?: number;
    "photovoltaic"?: number;
    "selfConsumption"?: number;
    "gridFeedIn"?: number;
    "hallHeatingFromWasteLoss"?: number;
    "frostProtectionHBWFromWasteLoss"?: number;
    "ambientHeat"?: number;
    "ventilationHeat"?: number;
    "personHeat"?: number;
    "groundwater"?: number;
    "woodChips"?: number;
};

type EnergyGeneration = {
    "hallLighting"?: number;
    "heatGeneration"?: number;
    "HbwHeat"?: number;
    "hallHeat"?: number;
};

type EnergyStorage = {
    "forklistBatteryCharging"?: number;
    "heatStorage"?: number;
};

type EnergyDistribution = {
    "heatDistribution"?: number;
    "intralogisticsHallDistribution"?: number,
    "intralogisticsHbwDistribution"?: number,
    "hallHeatDistribution"?: number,
    "HbwHeatDistribution"?: number
};

type EnergyTransfer = {
    "intralogisticsHallTransfer"?: number,
    "intralogisticsHbwTransfer"?: number,
    "hallHeatTransfer"?: number,
    "HbwHeatTransfer"?: number
    "heatTransfer"?: number,
    "ForkliftTransfer"?: number
};

type EnergyUsage = {
    "hallSpaceHeating"? : number,
    "work"?: number,
    "HbwFrostProtection"?: number,
};

type EnvironmentalFactor = {
    "cold"?: number;
};

type EnergyMix = {
    energyConsumption: EnergyConsumption;
    energyProduction: EnergyProduction;
};

type EnergyConsumption = {
    value: number;
    renewableEnergyShare: number;
};

type EnergyProduction = {
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