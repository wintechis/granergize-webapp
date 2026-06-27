import type { BuildingType } from "../../../types.ts";
import {
  BUILDING_NS,
  RDFS_LABEL,
  REC_NS,
  REC_OWNED_BY,
  SCHEMA_CUSTOMER,
  VCARD_NS,
} from "../vocabularies.ts";
import { type TermSchema, VOCAB_SCHEMA } from "../vocabSchema.generated.ts";

/**
 * The building field BRIDGE: each app field's `keyof BuildingType` key ⇄ its
 * predicate IRI. This is the ONE thing the vocab can't supply (the app's camelCase
 * key isn't derivable from the IRI local name), so it stays here; everything else —
 * the property's `rdfs:range`, datatype, and literal/agent/enum classification — is
 * read from `vocabSchema.generated.ts` (generated from `vocab/*.ttl`). A field whose
 * IRI the vocab doesn't declare (reused external string predicates: `schema:customer`,
 * `vcard:*`, `rdfs:label`) defaults to an `xsd:string` literal, as before.
 *
 * `field` is `keyof BuildingType`, so the table and the TS type can't drift on names
 * (a rename is a compile error). See notes/data-schema.md → "Two schemas".
 */
interface FieldDesc {
  field: keyof BuildingType;
  iri: string;
}

export const BUILDING_FIELDS: FieldDesc[] = [
  // SCHEMA_CUSTOMER stays on the http:// schema.org namespace (see SCHEMA_NS) to
  // keep matching existing Pod data; reconciling http/https is a separate,
  // data-affecting change.
  { field: "customer", iri: SCHEMA_CUSTOMER },
  // Coordinates are NOT mapped here — they live on a `geo:Point` blank node
  // (`addGeoPoint` / parser pass-2), never as flat `geo:lat`/`geo:long` on the building.
  { field: "locality", iri: `${VCARD_NS}locality` },
  // postalCode is an identifier, not a number — xsd:integer corrupted
  // leading-zero German postcodes ("01067" → 1067) on every round-trip.
  { field: "postalCode", iri: `${VCARD_NS}postal-code` },
  { field: "region", iri: `${VCARD_NS}region` },
  { field: "streetAddress", iri: `${VCARD_NS}street-address` },
  { field: "label", iri: RDFS_LABEL },
  { field: "buildingArea", iri: `${BUILDING_NS}hasBuildingArea` },
  { field: "landArea", iri: `${BUILDING_NS}hasLandArea` },
  // PV is no longer a flat field — it's the `<#pv>` :PVSystem node (bldg:hasSystem),
  // parsed/serialized as a subordinate node (see buildingParser/buildingSerializer).
  // Agent (WebID) links — building→agent relationship properties (NOT roles;
  // roles live only in data rooms). All range over foaf:Agent, so they
  // round-trip as NamedNodes (a legacy xsd:string value is tolerated on read).
  // Owner and operator are REC properties reused directly; the rest are minted
  // in BUILDING_NS. Only operatedBy carries behaviour (the Betreiber
  // benchmark); the others are descriptive.
  { field: "investor", iri: `${BUILDING_NS}investor` },
  { field: "ownedBy", iri: REC_OWNED_BY },
  { field: "operatedBy", iri: `${REC_NS}operatedBy` },
  { field: "facilityManagedBy", iri: `${BUILDING_NS}facilityManagedBy` },
  { field: "developedBy", iri: `${BUILDING_NS}developedBy` },
  { field: "consultedBy", iri: `${BUILDING_NS}consultedBy` },
  { field: "officeArea", iri: `${BUILDING_NS}officeArea` },
  { field: "usedAs", iri: `${BUILDING_NS}usedAs` },
  { field: "yearOfConstruction", iri: `${BUILDING_NS}yearOfConstruction` },
  { field: "energyCertificate", iri: `${BUILDING_NS}hasEnergyCertificate` },
  // naceCode is an identifier, not a number — xsd:decimal mangled it
  // ("52.10" → 52.1, a DIFFERENT NACE class).
  { field: "naceCode", iri: `${REC_NS}nace-code` },

  { field: "buildingCode", iri: `${BUILDING_NS}buildingCode` },
  { field: "hallArea", iri: `${BUILDING_NS}hallArea` },
  { field: "officeSocialArea", iri: `${BUILDING_NS}officeSocialArea` },
  { field: "buildingHeight", iri: `${BUILDING_NS}buildingHeight` },
  { field: "numberOfLoadingDocks", iri: `${BUILDING_NS}numberOfLoadingDocks` },
  { field: "yearOfRenovation", iri: `${BUILDING_NS}yearOfRenovation` },
  { field: "leaseType", iri: `${BUILDING_NS}leaseType` },
  { field: "tenantIndustry", iri: `${BUILDING_NS}tenantIndustry` },
  // Heat generators (oil/gas/electric boiler, heat pump, district heating) are NOT flat
  // fields — they're :TechnicalSystem nodes (bldg:hasSystem), parsed/serialised by kind
  // like PV/battery/CHP and edited in the "Heat generation" section.
  // Object properties (controlled vocabulary — range is the value's class).
  { field: "shiftRegime", iri: `${BUILDING_NS}shiftRegime` },
  { field: "tenancyType", iri: `${BUILDING_NS}tenancyType` },
  { field: "indoorTemperatureClass", iri: `${BUILDING_NS}indoorTemperatureClass` },

  { field: "logisticsFunction", iri: `${BUILDING_NS}logisticsFunction` },
  { field: "climateControlType", iri: `${BUILDING_NS}climateControlType` },
  { field: "greenLeaseShare", iri: `${BUILDING_NS}greenLeaseShare` },
  // Battery storage is no longer a flat field — it's the `<#battery>` :BatteryStorage
  // node (bldg:hasSystem), like PV. The parser/UI for it land with the loader work.
  { field: "companyName", iri: `${BUILDING_NS}companyName` },
];

// ── Range classification (sourced from the vocab via vocabSchema.generated.ts) ──
// A field's kind/datatype is read from the generated schema by its IRI; a field the
// vocab doesn't declare (reused external string predicates) defaults to a string
// literal — the app's prior behaviour.
const DEFAULT_SCHEMA: TermSchema = { kind: "literal", datatype: "string", functional: true };
/** A field IRI's vocab schema (kind/datatype/…), defaulting an undeclared external
 *  predicate to a string literal. The single read path for range-derived info. */
export const schemaFor = (iri: string): TermSchema => VOCAB_SCHEMA[iri] ?? DEFAULT_SCHEMA;

const literals = BUILDING_FIELDS.filter((f) => schemaFor(f.iri).kind === "literal");
const objects = BUILDING_FIELDS.filter((f) => schemaFor(f.iri).kind === "enum");
const iris = BUILDING_FIELDS.filter((f) => schemaFor(f.iri).kind === "agent");

/** Literal predicate IRI → BuildingType field. */
export const predicateMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(literals.map((f) => [f.iri, f.field]));

/** Investor object-property IRI → field (IRI objects mapped to local-name strings). */
export const objectPropertyMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(objects.map((f) => [f.iri, f.field]));

/** Agent/IRI-reference predicate IRI → field (object is a WebID NamedNode, stored verbatim). */
export const iriPropertyMap: { [iri: string]: keyof BuildingType } = Object
  .fromEntries(iris.map((f) => [f.iri, f.field]));

// Keyed by the XSD datatype LOCAL NAME (the generated schema's `datatype`).
const PARSERS: Record<string, (v: string) => number | boolean> = {
  integer: (v: string) => parseInt(v, 10),
  decimal: (v: string) => parseFloat(v),
  boolean: (v: string) => v.toLowerCase() === "true",
};

/** Field → literal coercion (string fields have no entry — left as-is). */
export const parsingFunctions: { [field: string]: (value: string) => number | boolean } = Object
  .fromEntries(
    literals
      .filter((f) => {
        const dt = schemaFor(f.iri).datatype;
        return !!(dt && PARSERS[dt]);
      })
      .map((f) => [f.field as string, PARSERS[schemaFor(f.iri).datatype as string]]),
  );

/** Field-name sets by literal datatype — consumed by the serializer (read+write
 * share one source). */
const fieldsWithDatatype = (dt: string): Set<string> =>
  new Set(
    literals.filter((f) => schemaFor(f.iri).datatype === dt).map((f) => f.field as string),
  );
export const INTEGER_FIELDS: Set<string> = fieldsWithDatatype("integer");
export const DECIMAL_FIELDS: Set<string> = fieldsWithDatatype("decimal");
export const BOOLEAN_FIELDS: Set<string> = fieldsWithDatatype("boolean");
