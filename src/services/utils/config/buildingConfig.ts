import type { BuildingType } from "../../../../types/types.ts";

const INVESTOR_NS = "https://solid.ti.rw.fau.de/private/granergize/investor-vocab.ttl#";
const BENCH_NS = "https://solid.ti.rw.fau.de/private/granergize/benchmark-vocab.ttl#";

export const predicateMap: { [key: string]: keyof BuildingType } = {
  "http://schema.org/customer": "customer",
  "http://www.w3.org/2003/01/geo/wgs84_pos#lat": "lat",
  "http://www.w3.org/2003/01/geo/wgs84_pos#long": "long",
  "http://www.w3.org/2006/vcard/ns#locality": "locality",
  "http://www.w3.org/2006/vcard/ns#postal-code": "postalCode",
  "http://www.w3.org/2006/vcard/ns#region": "region",
  "http://www.w3.org/2006/vcard/ns#street-address": "streetAddress",
  "http://www.w3.org/2000/01/rdf-schema#label": "label",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingArea":
    "buildingArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasLandArea":
    "landArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasPVSystem":
    "hasPVSystem",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#investor":
    "investor",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#officeArea":
    "officeArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#usedAs": "usedAs",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#yearOfConstruction":
    "yearOfConstruction",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyCertificate":
    "energyCertificate",
  "https://w3id.org/rec#nace-code": "naceCode",
  "https://w3id.org/rec#operatedBy": "operatedBy",
  // Investor-role predicates
  [`${INVESTOR_NS}buildingCode`]: "buildingCode",
  [`${INVESTOR_NS}hallArea`]: "hallArea",
  [`${INVESTOR_NS}officeSocialArea`]: "officeSocialArea",
  [`${INVESTOR_NS}buildingHeight`]: "buildingHeight",
  [`${INVESTOR_NS}numberOfLoadingDocks`]: "numberOfLoadingDocks",
  [`${INVESTOR_NS}yearOfRenovation`]: "yearOfRenovation",
  [`${INVESTOR_NS}leaseType`]: "leaseType",
  [`${INVESTOR_NS}tenantIndustry`]: "tenantIndustry",
  [`${INVESTOR_NS}hasOilBoiler`]: "hasOilBoiler",
  [`${INVESTOR_NS}hasGasBoiler`]: "hasGasBoiler",
  [`${INVESTOR_NS}hasElectricBoiler`]: "hasElectricBoiler",
  [`${INVESTOR_NS}hasHeatPump`]: "hasHeatPump",
  [`${INVESTOR_NS}hasDistrictHeating`]: "hasDistrictHeating",
  // BSP-role predicates
  [`${BENCH_NS}logisticsFunction`]: "logisticsFunction",
  [`${BENCH_NS}climateControlType`]: "climateControlType",
  [`${BENCH_NS}greenLeaseShare`]: "greenLeaseShare",
  [`${BENCH_NS}indoorTemperature`]: "indoorTemperature",
  [`${BENCH_NS}pvInstallationYear`]: "pvInstallationYear",
  [`${BENCH_NS}pvCapacityKW`]: "pvCapacityKW",
  [`${BENCH_NS}companyName`]: "companyName",
};

/** Investor object-property predicates whose IRI objects should be mapped to local name strings */
export const objectPropertyMap: { [key: string]: keyof BuildingType } = {
  [`${INVESTOR_NS}shiftRegime`]: "shiftRegime",
  [`${INVESTOR_NS}tenancyType`]: "tenancyType",
  [`${INVESTOR_NS}indoorTemperatureClass`]: "indoorTemperatureClass",
};

/** IRI local-name - human-readable label for investor controlled-vocabulary instances */
export const investorLocalNameLabels: Record<string, string> = {
  OneShift: "1-Shift",
  TwoShift: "2-Shift",
  ThreeShift: "3-Shift",
  SingleTenant: "Single Tenant",
  MultiTenant: "Multi Tenant",
  MaxTwelveDegrees: "≤12 °C",
  MaxEighteenDegrees: "≤18 °C",
  Low: "Low",
  Simple: "Simple",
  Medium: "Medium",
  High: "High",
  AllRisk: "All-Risk",
  FullServiceManagement: "Full Service",
};

export const parsingFunctions: {
  [key: string]: (value: string) => number | boolean;
} = {
  "lat": parseFloat,
  "long": parseFloat,
  "postalCode": parseInt,
  "buildingArea": parseInt,
  "landArea": parseInt,
  "hasPVSystem": (value: string) => value.toLowerCase() === "true",
  "officeArea": parseInt,
  "yearOfConstruction": parseInt,
  "naceCode": parseFloat,
  // Investor numeric fields
  "hallArea": parseFloat,
  "officeSocialArea": parseFloat,
  "buildingHeight": parseFloat,
  "numberOfLoadingDocks": parseInt,
  "yearOfRenovation": parseInt,
  // Investor boolean fields
  "hasOilBoiler": (value: string) => value.toLowerCase() === "true",
  "hasGasBoiler": (value: string) => value.toLowerCase() === "true",
  "hasElectricBoiler": (value: string) => value.toLowerCase() === "true",
  "hasHeatPump": (value: string) => value.toLowerCase() === "true",
  "hasDistrictHeating": (value: string) => value.toLowerCase() === "true",
  // BSP numeric fields
  "greenLeaseShare": parseFloat,
  "pvInstallationYear": parseInt,
  "pvCapacityKW": parseFloat,
};
