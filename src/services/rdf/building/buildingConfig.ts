import type { BuildingType } from "../../../types.ts";
import {
  BUILDING_NS,
  FOAF_AGENT,
  REC_NS,
  REC_OWNED_BY,
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
 *     read/written by local name via {@link investorLocalNameLabels} (e.g.
 *     `shiftRegime` ranges over `bldg:ShiftRegime`, value `OneShift`).
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
  // NOTE: schema.org is inconsistently http/https across the codebase. Left as
  // http here to preserve matching of existing Pod data — reconciling it is a
  // separate, data-affecting change.
  { field: "customer", iri: "http://schema.org/customer" },
  { field: "lat", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#lat", range: XSD_DECIMAL },
  { field: "long", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#long", range: XSD_DECIMAL },
  { field: "locality", iri: `${VCARD_NS}locality` },
  // postalCode is an identifier, not a number — xsd:integer corrupted
  // leading-zero German postcodes ("01067" → 1067) on every round-trip.
  { field: "postalCode", iri: `${VCARD_NS}postal-code` },
  { field: "region", iri: `${VCARD_NS}region` },
  { field: "streetAddress", iri: `${VCARD_NS}street-address` },
  { field: "label", iri: "http://www.w3.org/2000/01/rdf-schema#label" },
  { field: "buildingArea", iri: `${BUILDING_NS}hasBuildingArea`, range: XSD_INTEGER },
  { field: "landArea", iri: `${BUILDING_NS}hasLandArea`, range: XSD_INTEGER },
  { field: "hasPVSystem", iri: `${BUILDING_NS}hasPVSystem`, range: XSD_BOOLEAN },
  // Agent (WebID) links: investor, owner and operator range over foaf:Agent, so
  // they round-trip as NamedNodes (a legacy xsd:string value is tolerated on
  // read). Owner and operator are REC properties reused directly.
  { field: "investor", iri: `${BUILDING_NS}investor`, range: FOAF_AGENT },
  { field: "ownedBy", iri: REC_OWNED_BY, range: FOAF_AGENT },
  { field: "operatedBy", iri: `${REC_NS}operatedBy`, range: FOAF_AGENT },
  { field: "officeArea", iri: `${BUILDING_NS}officeArea`, range: XSD_INTEGER },
  { field: "usedAs", iri: `${BUILDING_NS}usedAs` },
  { field: "yearOfConstruction", iri: `${BUILDING_NS}yearOfConstruction`, range: XSD_INTEGER },
  { field: "energyCertificate", iri: `${BUILDING_NS}hasEnergyCertificate` },
  // naceCode is an identifier, not a number — xsd:decimal mangled it
  // ("52.10" → 52.1, a DIFFERENT NACE class).
  { field: "naceCode", iri: `${REC_NS}nace-code` },

  { field: "buildingCode", iri: `${BUILDING_NS}buildingCode` },
  { field: "hallArea", iri: `${BUILDING_NS}hallArea`, range: XSD_DECIMAL },
  { field: "officeSocialArea", iri: `${BUILDING_NS}officeSocialArea`, range: XSD_DECIMAL },
  { field: "buildingHeight", iri: `${BUILDING_NS}buildingHeight`, range: XSD_DECIMAL },
  { field: "numberOfLoadingDocks", iri: `${BUILDING_NS}numberOfLoadingDocks`, range: XSD_INTEGER },
  { field: "yearOfRenovation", iri: `${BUILDING_NS}yearOfRenovation`, range: XSD_INTEGER },
  { field: "leaseType", iri: `${BUILDING_NS}leaseType` },
  { field: "tenantIndustry", iri: `${BUILDING_NS}tenantIndustry` },
  { field: "hasOilBoiler", iri: `${BUILDING_NS}hasOilBoiler`, range: XSD_BOOLEAN },
  { field: "hasGasBoiler", iri: `${BUILDING_NS}hasGasBoiler`, range: XSD_BOOLEAN },
  { field: "hasElectricBoiler", iri: `${BUILDING_NS}hasElectricBoiler`, range: XSD_BOOLEAN },
  { field: "hasHeatPump", iri: `${BUILDING_NS}hasHeatPump`, range: XSD_BOOLEAN },
  { field: "hasDistrictHeating", iri: `${BUILDING_NS}hasDistrictHeating`, range: XSD_BOOLEAN },
  // Object properties (controlled vocabulary — range is the value's class).
  { field: "shiftRegime", iri: `${BUILDING_NS}shiftRegime`, range: `${BUILDING_NS}ShiftRegime` },
  { field: "tenancyType", iri: `${BUILDING_NS}tenancyType`, range: `${BUILDING_NS}TenancyType` },
  { field: "indoorTemperatureClass", iri: `${BUILDING_NS}indoorTemperatureClass`, range: `${BUILDING_NS}IndoorTemperatureClass` },

  { field: "logisticsFunction", iri: `${BUILDING_NS}logisticsFunction` },
  { field: "climateControlType", iri: `${BUILDING_NS}climateControlType` },
  { field: "greenLeaseShare", iri: `${BUILDING_NS}greenLeaseShare`, range: XSD_DECIMAL },
  { field: "pvInstallationYear", iri: `${BUILDING_NS}pvInstallationYear`, range: XSD_INTEGER },
  { field: "pvCapacityKW", iri: `${BUILDING_NS}pvCapacityKW`, range: XSD_DECIMAL },
  { field: "companyName", iri: `${BUILDING_NS}companyName` },
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
