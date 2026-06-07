import type { BuildingType } from "../../../../types/types.ts";
import {
  BENCH_NS,
  FOAF_AGENT,
  GRAN_NS,
  INVESTOR_NS,
  REC_NS,
  VCARD_NS,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_INTEGER,
  XSD_NS,
} from "../vocabularies.ts";

/**
 * Single source of truth for the building field schema: predicate IRI ⇄ object
 * field, plus the property's `rdfs:range`. Everything else in the read/write path
 * is derived from this table (predicate maps, parse functions, the serializer's
 * datatype sets), so a field is declared in exactly one place.
 *
 * - `field` is `keyof BuildingType`, so the table and the TS type can't drift on
 *   names (a rename is a compile error).
 * - `range` is the property's `rdfs:range` and decides how the object is read/written:
 *   - an **XSD datatype** IRI (or omitted ⇒ `xsd:string`) → a typed **literal**;
 *   - **`foaf:Agent`** → an **IRI reference** (a WebID NamedNode, written verbatim);
 *   - any other **class IRI** → a controlled-vocabulary **object** whose instance is
 *     read/written by local name via {@link investorLocalNameLabels} (e.g. investor
 *     `shiftRegime` ranges over `investor:ShiftRegime`, value `OneShift`).
 *
 * See notes/data-schema.md → "Two schemas: RDF graph ⇄ app objects".
 */
interface FieldDesc {
  field: keyof BuildingType;
  iri: string;
  /** rdfs:range — XSD datatype (literal; omitted ⇒ xsd:string), foaf:Agent (IRI ref), or a class IRI (object). */
  range?: string;
}

export const BUILDING_FIELDS: FieldDesc[] = [
  // Core (all roles).
  // NOTE: schema.org is inconsistently http/https across the codebase. Left as
  // http here to preserve matching of existing Pod data — reconciling it is a
  // separate, data-affecting change.
  { field: "customer", iri: "http://schema.org/customer" },
  { field: "lat", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#lat", range: XSD_DECIMAL },
  { field: "long", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#long", range: XSD_DECIMAL },
  { field: "locality", iri: `${VCARD_NS}locality` },
  { field: "postalCode", iri: `${VCARD_NS}postal-code`, range: XSD_INTEGER },
  { field: "region", iri: `${VCARD_NS}region` },
  { field: "streetAddress", iri: `${VCARD_NS}street-address` },
  { field: "label", iri: "http://www.w3.org/2000/01/rdf-schema#label" },
  { field: "buildingArea", iri: `${GRAN_NS}hasBuildingArea`, range: XSD_INTEGER },
  { field: "landArea", iri: `${GRAN_NS}hasLandArea`, range: XSD_INTEGER },
  { field: "hasPVSystem", iri: `${GRAN_NS}hasPVSystem`, range: XSD_BOOLEAN },
  { field: "investor", iri: `${GRAN_NS}investor` },
  { field: "officeArea", iri: `${GRAN_NS}officeArea`, range: XSD_INTEGER },
  { field: "usedAs", iri: `${GRAN_NS}usedAs` },
  { field: "yearOfConstruction", iri: `${GRAN_NS}yearOfConstruction`, range: XSD_INTEGER },
  { field: "energyCertificate", iri: `${GRAN_NS}hasEnergyCertificate` },
  { field: "naceCode", iri: `${REC_NS}nace-code`, range: XSD_DECIMAL },
  // rec:operatedBy ranges over an Agent (a WebID IRI), so it round-trips as a NamedNode.
  { field: "operatedBy", iri: `${REC_NS}operatedBy`, range: FOAF_AGENT },

  // Investor role.
  { field: "buildingCode", iri: `${INVESTOR_NS}buildingCode` },
  { field: "hallArea", iri: `${INVESTOR_NS}hallArea`, range: XSD_DECIMAL },
  { field: "officeSocialArea", iri: `${INVESTOR_NS}officeSocialArea`, range: XSD_DECIMAL },
  { field: "buildingHeight", iri: `${INVESTOR_NS}buildingHeight`, range: XSD_DECIMAL },
  { field: "numberOfLoadingDocks", iri: `${INVESTOR_NS}numberOfLoadingDocks`, range: XSD_INTEGER },
  { field: "yearOfRenovation", iri: `${INVESTOR_NS}yearOfRenovation`, range: XSD_INTEGER },
  { field: "leaseType", iri: `${INVESTOR_NS}leaseType` },
  { field: "tenantIndustry", iri: `${INVESTOR_NS}tenantIndustry` },
  { field: "hasOilBoiler", iri: `${INVESTOR_NS}hasOilBoiler`, range: XSD_BOOLEAN },
  { field: "hasGasBoiler", iri: `${INVESTOR_NS}hasGasBoiler`, range: XSD_BOOLEAN },
  { field: "hasElectricBoiler", iri: `${INVESTOR_NS}hasElectricBoiler`, range: XSD_BOOLEAN },
  { field: "hasHeatPump", iri: `${INVESTOR_NS}hasHeatPump`, range: XSD_BOOLEAN },
  { field: "hasDistrictHeating", iri: `${INVESTOR_NS}hasDistrictHeating`, range: XSD_BOOLEAN },
  // Investor object properties (controlled vocabulary — range is the value's class).
  { field: "shiftRegime", iri: `${INVESTOR_NS}shiftRegime`, range: `${INVESTOR_NS}ShiftRegime` },
  { field: "tenancyType", iri: `${INVESTOR_NS}tenancyType`, range: `${INVESTOR_NS}TenancyType` },
  { field: "indoorTemperatureClass", iri: `${INVESTOR_NS}indoorTemperatureClass`, range: `${INVESTOR_NS}IndoorTemperatureClass` },

  // Benchmark (BSP) role.
  { field: "logisticsFunction", iri: `${BENCH_NS}logisticsFunction` },
  { field: "climateControlType", iri: `${BENCH_NS}climateControlType` },
  { field: "greenLeaseShare", iri: `${BENCH_NS}greenLeaseShare`, range: XSD_DECIMAL },
  { field: "indoorTemperature", iri: `${BENCH_NS}indoorTemperature` },
  { field: "pvInstallationYear", iri: `${BENCH_NS}pvInstallationYear`, range: XSD_INTEGER },
  { field: "pvCapacityKW", iri: `${BENCH_NS}pvCapacityKW`, range: XSD_DECIMAL },
  { field: "companyName", iri: `${BENCH_NS}companyName` },
];

// ── Range classification (don't edit — change BUILDING_FIELDS) ──────────────────
// Literal: range is an XSD datatype, or omitted (⇒ xsd:string). IRI ref: foaf:Agent.
// Object (controlled vocab): any other class IRI.
const isXsd = (range?: string): boolean => !range || range.startsWith(XSD_NS);
const isAgent = (range?: string): boolean => range === FOAF_AGENT;

const literals = BUILDING_FIELDS.filter((f) => isXsd(f.range));
const objects = BUILDING_FIELDS.filter((f) => !isXsd(f.range) && !isAgent(f.range));
const iris = BUILDING_FIELDS.filter((f) => isAgent(f.range));

/** Literal predicate IRI → BuildingType field. */
export const predicateMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(literals.map((f) => [f.iri, f.field]));

/** Investor object-property IRI → field (IRI objects mapped to local-name strings). */
export const objectPropertyMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(objects.map((f) => [f.iri, f.field]));

/** Agent/IRI-reference predicate IRI → field (object is a WebID NamedNode, stored verbatim). */
export const iriPropertyMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(iris.map((f) => [f.iri, f.field]));

const PARSERS: Record<string, (v: string) => number | boolean> = {
  [XSD_INTEGER]: (v: string) => parseInt(v, 10),
  [XSD_DECIMAL]: (v: string) => parseFloat(v),
  [XSD_BOOLEAN]: (v: string) => v.toLowerCase() === "true",
};

/** Field → literal coercion (string fields have no entry — left as-is). */
export const parsingFunctions: { [field: string]: (value: string) => number | boolean } = Object
  .fromEntries(
    literals
      .filter((f) => f.range && PARSERS[f.range])
      .map((f) => [f.field as string, PARSERS[f.range as string]]),
  );

/** Field-name sets by literal datatype — consumed by the serializer (read+write
 * share one source). */
export const INTEGER_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.range === XSD_INTEGER).map((f) => f.field as string),
);
export const DECIMAL_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.range === XSD_DECIMAL).map((f) => f.field as string),
);
export const BOOLEAN_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.range === XSD_BOOLEAN).map((f) => f.field as string),
);

/** IRI local-name → human-readable label for investor controlled-vocabulary instances. */
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
