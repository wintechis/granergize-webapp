import type { BuildingType } from "../../../../types/types.ts";
import { BENCH_NS, GRAN_NS, INVESTOR_NS, VCARD_NS } from "../vocabularies.ts";

export const predicateMap: { [key: string]: keyof BuildingType } = {
  // NOTE: schema.org is inconsistently http/https across the codebase
  // (agentParser uses https). Left as http here to preserve matching of
  // existing Pod data — reconciling it is a separate, data-affecting change.
  "http://schema.org/customer": "customer",
  "http://www.w3.org/2003/01/geo/wgs84_pos#lat": "lat",
  "http://www.w3.org/2003/01/geo/wgs84_pos#long": "long",
  [`${VCARD_NS}locality`]: "locality",
  [`${VCARD_NS}postal-code`]: "postalCode",
  [`${VCARD_NS}region`]: "region",
  [`${VCARD_NS}street-address`]: "streetAddress",
  "http://www.w3.org/2000/01/rdf-schema#label": "label",
  [`${GRAN_NS}hasBuildingArea`]: "buildingArea",
  [`${GRAN_NS}hasLandArea`]: "landArea",
  [`${GRAN_NS}hasPVSystem`]: "hasPVSystem",
  [`${GRAN_NS}investor`]: "investor",
  [`${GRAN_NS}officeArea`]: "officeArea",
  [`${GRAN_NS}usedAs`]: "usedAs",
  [`${GRAN_NS}yearOfConstruction`]: "yearOfConstruction",
  [`${GRAN_NS}hasEnergyCertificate`]: "energyCertificate",
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
