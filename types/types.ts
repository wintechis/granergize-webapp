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
    "energy need": EnergyNeed;
    "energy generation": EnergyGeneration;
    "energy storage": EnergyStorage;
    "energy distribution": EnergyDistribution;
    "energy transfer": EnergyTransfer;
    "energy usage": EnergyUsage;
    "environmental factor": EnvironmentalFactor;
};

type EnergyNeed = {
    "gas"?: number;
    "electricity"?: number;
    "grid supply"?: number;
    "solar"?: number;
    "photovoltaic"?: number;
    "self consumption"?: number;
    "grid feed in"?: number;
    "hall heating from waste loss"?: number;
    "frost protection HRL from waste loss"?: number;
    "ambient heat"?: number;
    "ventilation heat"?: number;
    "person heat"?: number;
    "wood chips"?: number;
};

type EnergyGeneration = {
    "hall lighting"?: number;
    "heat generation"?: number;
    "HRL heat"?: number;
    "hall heat"?: number;
};

type EnergyStorage = {
    "FFZ battery charging"?: number;
    "heat storage"?: number;
};

type EnergyDistribution = {
    "heat distribution"?: number;
    "intralogistics hall"?: number,
    "intralogistics HRL"?: number,
    "hall heat"?: number,
    "HRL heat"?: number
};

type EnergyTransfer = {
    "intralogistics hall"?: number,
    "intralogistics HRL"?: number,
    "hall heat"?: number,
    "HRL heat"?: number
    "heat transfer"?: number,
    "FFZ"?: number
};

type EnergyUsage = {
    "hall space heating"? : number,
    "work"?: number,
    "HRL frost protection"?: number,
};

type EnvironmentalFactor = {
    "cold"?: number;
}