export interface BuildingType {
    id: number;
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
};

export type AgentType = {
    id: string;
    type: string;
    name: string;
};

export type EnergyType = {
    id: number;
    energyNeed: EnergyNeed;
    energyGeneration: EnergyGeneration;
    energyStorage: EnergyStorage;
    energyDistribution: EnergyDistribution;
    energyTransfer: EnergyTransfer;
    energyUsage: EnergyUsage;
    environmentalFactor: EnvironmentalFactor;
};

type EnergyNeed = {
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
    hallLighting?: number;
    heatGeneration?: number;
    HbwHeat?: number;
    hallHeat?: number;
};

type EnergyStorage = {
    forkliftBatteryCharging?: number;
    heatStorage?: number;
};

type EnergyDistribution = {
    heatDistribution?: number;
    intralogisticsHallDistribution?: number,
    intralogisticsHbwDistribution?: number,
    hallHeatDistribution?: number,
    HbwHeatDistribution?: number
};

type EnergyTransfer = {
    intralogisticsHallTransfer?: number,
    intralogisticsHbwTransfer?: number,
    hallHeatTransfer?: number,
    HbwHeatTransfer?: number
    heatTransfer?: number,
    ForkliftTransfer?: number
};

type EnergyUsage = {
    hallSpaceHeating? : number,
    work?: number,
    HbwFrostProtection?: number,
};

type EnvironmentalFactor = {
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