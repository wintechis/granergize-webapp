import type { BuildingType } from "../../../../types/types.ts";
import { BENCH_NS, GRAN_NS, INVESTOR_NS, VCARD_NS } from "../vocabularies.ts";

/**
 * Single source of truth for the building field schema: predicate IRI ⇄ object
 * field, plus how the literal is typed. Everything else in the read/write path is
 * derived from this table (predicate maps, parse functions, the serializer's
 * datatype sets), so a field is declared in exactly one place.
 *
 * - `field` is `keyof BuildingType`, so the table and the TS type can't drift on
 *   names (a rename is a compile error).
 * - `kind: "object"` is an investor controlled-vocabulary IRI whose local name is
 *   shown via {@link investorLocalNameLabels}; `kind: "literal"` is a plain value
 *   typed by `type` (default "string").
 *
 * See notes/data-schema.md → "Two schemas: RDF graph ⇄ app objects".
 */
type LiteralType = "string" | "integer" | "decimal" | "boolean";

interface FieldDesc {
  field: keyof BuildingType;
  iri: string;
  kind: "literal" | "object";
  type?: LiteralType; // literal only; default "string"
}

export const BUILDING_FIELDS: FieldDesc[] = [
  // Core (all roles).
  // NOTE: schema.org is inconsistently http/https across the codebase
  // (agentParser uses https). Left as http here to preserve matching of existing
  // Pod data — reconciling it is a separate, data-affecting change.
  { field: "customer", iri: "http://schema.org/customer", kind: "literal" },
  { field: "lat", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#lat", kind: "literal", type: "decimal" },
  { field: "long", iri: "http://www.w3.org/2003/01/geo/wgs84_pos#long", kind: "literal", type: "decimal" },
  { field: "locality", iri: `${VCARD_NS}locality`, kind: "literal" },
  { field: "postalCode", iri: `${VCARD_NS}postal-code`, kind: "literal", type: "integer" },
  { field: "region", iri: `${VCARD_NS}region`, kind: "literal" },
  { field: "streetAddress", iri: `${VCARD_NS}street-address`, kind: "literal" },
  { field: "label", iri: "http://www.w3.org/2000/01/rdf-schema#label", kind: "literal" },
  { field: "buildingArea", iri: `${GRAN_NS}hasBuildingArea`, kind: "literal", type: "integer" },
  { field: "landArea", iri: `${GRAN_NS}hasLandArea`, kind: "literal", type: "integer" },
  { field: "hasPVSystem", iri: `${GRAN_NS}hasPVSystem`, kind: "literal", type: "boolean" },
  { field: "investor", iri: `${GRAN_NS}investor`, kind: "literal" },
  { field: "officeArea", iri: `${GRAN_NS}officeArea`, kind: "literal", type: "integer" },
  { field: "usedAs", iri: `${GRAN_NS}usedAs`, kind: "literal" },
  { field: "yearOfConstruction", iri: `${GRAN_NS}yearOfConstruction`, kind: "literal", type: "integer" },
  { field: "energyCertificate", iri: `${GRAN_NS}hasEnergyCertificate`, kind: "literal" },
  { field: "naceCode", iri: "https://w3id.org/rec#nace-code", kind: "literal", type: "decimal" },
  { field: "operatedBy", iri: "https://w3id.org/rec#operatedBy", kind: "literal" },

  // Investor role.
  { field: "buildingCode", iri: `${INVESTOR_NS}buildingCode`, kind: "literal" },
  { field: "hallArea", iri: `${INVESTOR_NS}hallArea`, kind: "literal", type: "decimal" },
  { field: "officeSocialArea", iri: `${INVESTOR_NS}officeSocialArea`, kind: "literal", type: "decimal" },
  { field: "buildingHeight", iri: `${INVESTOR_NS}buildingHeight`, kind: "literal", type: "decimal" },
  { field: "numberOfLoadingDocks", iri: `${INVESTOR_NS}numberOfLoadingDocks`, kind: "literal", type: "integer" },
  { field: "yearOfRenovation", iri: `${INVESTOR_NS}yearOfRenovation`, kind: "literal", type: "integer" },
  { field: "leaseType", iri: `${INVESTOR_NS}leaseType`, kind: "literal" },
  { field: "tenantIndustry", iri: `${INVESTOR_NS}tenantIndustry`, kind: "literal" },
  { field: "hasOilBoiler", iri: `${INVESTOR_NS}hasOilBoiler`, kind: "literal", type: "boolean" },
  { field: "hasGasBoiler", iri: `${INVESTOR_NS}hasGasBoiler`, kind: "literal", type: "boolean" },
  { field: "hasElectricBoiler", iri: `${INVESTOR_NS}hasElectricBoiler`, kind: "literal", type: "boolean" },
  { field: "hasHeatPump", iri: `${INVESTOR_NS}hasHeatPump`, kind: "literal", type: "boolean" },
  { field: "hasDistrictHeating", iri: `${INVESTOR_NS}hasDistrictHeating`, kind: "literal", type: "boolean" },
  // Investor object properties (IRI → local name).
  { field: "shiftRegime", iri: `${INVESTOR_NS}shiftRegime`, kind: "object" },
  { field: "tenancyType", iri: `${INVESTOR_NS}tenancyType`, kind: "object" },
  { field: "indoorTemperatureClass", iri: `${INVESTOR_NS}indoorTemperatureClass`, kind: "object" },

  // Benchmark (BSP) role.
  { field: "logisticsFunction", iri: `${BENCH_NS}logisticsFunction`, kind: "literal" },
  { field: "climateControlType", iri: `${BENCH_NS}climateControlType`, kind: "literal" },
  { field: "greenLeaseShare", iri: `${BENCH_NS}greenLeaseShare`, kind: "literal", type: "decimal" },
  { field: "indoorTemperature", iri: `${BENCH_NS}indoorTemperature`, kind: "literal" },
  { field: "pvInstallationYear", iri: `${BENCH_NS}pvInstallationYear`, kind: "literal", type: "integer" },
  { field: "pvCapacityKW", iri: `${BENCH_NS}pvCapacityKW`, kind: "literal", type: "decimal" },
  { field: "companyName", iri: `${BENCH_NS}companyName`, kind: "literal" },
];

// ── Derived maps (don't edit — change BUILDING_FIELDS) ──────────────────────────

const literals = BUILDING_FIELDS.filter((f) => f.kind === "literal");
const objects = BUILDING_FIELDS.filter((f) => f.kind === "object");

/** Literal predicate IRI → BuildingType field. */
export const predicateMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(literals.map((f) => [f.iri, f.field]));

/** Investor object-property IRI → field (IRI objects mapped to local-name strings). */
export const objectPropertyMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(objects.map((f) => [f.iri, f.field]));

const PARSERS: Record<Exclude<LiteralType, "string">, (v: string) => number | boolean> = {
  integer: (v: string) => parseInt(v, 10),
  decimal: (v: string) => parseFloat(v),
  boolean: (v: string) => v.toLowerCase() === "true",
};

/** Field → literal coercion (string fields have no entry — left as-is). */
export const parsingFunctions: { [field: string]: (value: string) => number | boolean } = Object
  .fromEntries(
    literals
      .filter((f) => f.type && f.type !== "string")
      .map((f) => [f.field as string, PARSERS[f.type as Exclude<LiteralType, "string">]]),
  );

/** Field-name sets by literal datatype — consumed by the serializer (read+write
 * share one source). */
export const INTEGER_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.type === "integer").map((f) => f.field as string),
);
export const DECIMAL_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.type === "decimal").map((f) => f.field as string),
);
export const BOOLEAN_FIELDS: Set<string> = new Set(
  literals.filter((f) => f.type === "boolean").map((f) => f.field as string),
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
