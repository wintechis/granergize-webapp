/**
 * Codegen: derive the building-family TS data interfaces from `vocab/building.ttl`,
 * emitting `src/services/rdf/buildingShape.generated.ts`:
 *   - enum unions from each controlled-vocab class's instances (the stable tokens),
 *   - one `*Fields` interface per node class (properties grouped by `rdfs:domain`,
 *     folding subclasses into their base; field name == IRI local name),
 *   - `BuildingFlatFields` from the `BUILDING_FIELDS` bridge (the flat fields include
 *     reused external IRIs not domained on rec:Building, so the bridge is the field list).
 *
 * Sibling of `genVocabSchema.ts`. Run via `deno task gen:interface`; a freshness test
 * (`buildingShape.test.ts`) regenerates in memory and asserts equality, so it can't drift.
 * NOTE: this imports `BUILDING_FIELDS`/`schemaFor`, which transitively import `types.ts`.
 * `types.ts` imports the GENERATED file by `import type` only — so generate it once before
 * wiring that import (no runtime cycle thereafter; the generated module imports nothing).
 */

import { Parser } from "n3";
import { BUILDING_FIELDS, schemaFor } from "../src/services/rdf/building/buildingConfig.ts";
import { VOCAB_SCHEMA } from "../src/services/rdf/vocabSchema.generated.ts";
import {
  AGGREGATION_DEFINITION_FIELDS,
  AGGREGATION_SNAPSHOT_FIELDS,
  type ConsumptionField,
  ENERGY_DATASET_FIELDS,
} from "../src/services/rdf/consumption/consumptionConfig.ts";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDFS_CLASS = "http://www.w3.org/2000/01/rdf-schema#Class";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_DATATYPE_PROP = "http://www.w3.org/2002/07/owl#DatatypeProperty";
const OWL_OBJECT_PROP = "http://www.w3.org/2002/07/owl#ObjectProperty";

const BUILDING_NS = "https://solid.ti.rw.fau.de/gra/building.ttl#";
const REC_BUILDING = "https://w3id.org/rec#Building";
const GEO_POINT = "http://www.w3.org/2003/01/geo/wgs84_pos#Point";

/** Datatype local names that map to a TS `number` (everything else → `string`). */
const NUMBER_DT = new Set(["integer", "decimal", "gYear"]);
/** Interface-name overrides; otherwise localName + "Fields". */
const IFACE_NAME: Record<string, string> = { [GEO_POINT]: "GeoPointFields" };

const localName = (iri: string): string => iri.split(/[#/]/).pop()!;
const ifaceName = (cls: string): string => IFACE_NAME[cls] ?? `${localName(cls)}Fields`;

interface VocabModel {
  /** node/enum class → its declared instance tokens (local names), sorted. */
  instances: Map<string, string[]>;
  /** property IRI → its rdfs:domain class IRI. */
  domain: Map<string, string>;
  /** class → its direct rdfs:subClassOf supers. */
  superOf: Map<string, Set<string>>;
  /** every class IRI declared (rdfs:Class / owl:Class). */
  classes: Set<string>;
  /** every property IRI (owl:Datatype/ObjectProperty). */
  properties: Set<string>;
}

export function parseVocab(repoRoot: string): VocabModel {
  const ttl = Deno.readTextFileSync(`${repoRoot}/vocab/building.ttl`);
  const quads = new Parser({ baseIRI: BUILDING_NS.slice(0, -1) }).parse(ttl);
  const types = new Map<string, Set<string>>();
  const domain = new Map<string, string>();
  const superOf = new Map<string, Set<string>>();
  for (const q of quads) {
    const s = q.subject.value, o = q.object.value;
    if (q.predicate.value === RDF_TYPE) {
      (types.get(s) ?? types.set(s, new Set()).get(s)!).add(o);
    } else if (q.predicate.value === RDFS_DOMAIN) {
      domain.set(s, o);
    } else if (q.predicate.value === RDFS_SUBCLASS) {
      (superOf.get(s) ?? superOf.set(s, new Set()).get(s)!).add(o);
    }
  }
  const classes = new Set<string>();
  const properties = new Set<string>();
  for (const [s, ts] of types) {
    if (ts.has(RDFS_CLASS) || ts.has(OWL_CLASS)) classes.add(s);
    if (ts.has(OWL_DATATYPE_PROP) || ts.has(OWL_OBJECT_PROP)) properties.add(s);
  }
  const instances = new Map<string, string[]>();
  for (const [s, ts] of types) {
    for (const t of ts) {
      if (classes.has(t)) (instances.get(t) ?? instances.set(t, []).get(t)!).push(s);
    }
  }
  for (const [, list] of instances) list.sort();
  return { instances, domain, superOf, classes, properties };
}

/** TS type for a property IRI, from its generated schema. */
function tsType(iri: string): string {
  const s = schemaFor(iri);
  if (s.kind === "enum" && s.range) return localName(s.range);
  if (s.kind === "literal" && s.datatype && NUMBER_DT.has(s.datatype)) return "number";
  return "string";
}

/** Is `cls` an enum (controlled-vocab) class — has declared instances? */
const isEnumClass = (m: VocabModel, cls: string): boolean => (m.instances.get(cls)?.length ?? 0) > 0;

/** All node-shape classes: a domain class that isn't rec:Building and isn't an enum. */
function nodeClasses(m: VocabModel): string[] {
  const domains = new Set(m.domain.values());
  return [...domains].filter((c) => c !== REC_BUILDING && !isEnumClass(m, c)).sort();
}

/** Properties whose domain is `cls` or any subclass of `cls`. */
function propsForClass(m: VocabModel, cls: string): string[] {
  const fam = new Set([cls]);
  for (const [sub, supers] of m.superOf) if (supers.has(cls)) fam.add(sub);
  return [...m.properties].filter((p) => fam.has(m.domain.get(p) ?? "")).sort();
}

export function render(m: VocabModel): string {
  const lines: string[] = [
    "// GENERATED by `deno task gen:interface` — do not edit",
    "//",
    "// Building-family data interfaces derived from vocab/building.ttl (properties grouped",
    "// by rdfs:domain) + enum unions from the controlled-vocab instances. Source of truth is",
    "// the .ttl; regenerate with `deno task gen:interface`. A freshness test guards drift.",
    "",
  ];

  // Enum unions (referenced by the interfaces below), sorted by type name.
  const enumClasses = [...m.classes].filter((c) => isEnumClass(m, c)).sort((a, b) =>
    localName(a).localeCompare(localName(b))
  );
  for (const cls of enumClasses) {
    const toks = m.instances.get(cls)!.map((i) => JSON.stringify(localName(i))).join(" | ");
    lines.push(`export type ${localName(cls)} = ${toks};`);
  }
  lines.push("");

  // One *Fields interface per node class (subclasses folded into the base).
  const subOfNode = new Set<string>();
  const nodes = nodeClasses(m);
  for (const c of nodes) {
    for (const other of nodes) {
      if (other !== c && (m.superOf.get(c)?.has(other) ?? false)) subOfNode.add(c);
    }
  }
  for (const cls of nodes.filter((c) => !subOfNode.has(c))) {
    lines.push(`export interface ${ifaceName(cls)} {`);
    for (const p of propsForClass(m, cls)) {
      lines.push(`  ${localName(p)}?: ${tsType(p)};`);
    }
    lines.push("}", "");
  }

  // BuildingFlatFields from the app-key↔IRI bridge.
  lines.push("export interface BuildingFlatFields {");
  for (const f of BUILDING_FIELDS) {
    lines.push(`  ${String(f.field)}?: ${tsType(f.iri)};`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

// ── Consumption family (Aggregation/EnergyDataset) ─────────────────────────────
// Driven by the field↔IRI bridges in consumptionConfig.ts (the app key isn't the IRI
// local name, and these records are mostly required); the TS type comes from the
// bridge's `tsType` override else the property's vocabSchema range.

const NUMBER_DT_CONS = new Set(["integer", "decimal"]);
function consTsType(f: ConsumptionField): string {
  if (f.tsType) return f.tsType;
  const s = VOCAB_SCHEMA[f.iri];
  if (s?.kind === "literal" && s.datatype) {
    if (NUMBER_DT_CONS.has(s.datatype)) return "number";
    if (s.datatype === "boolean") return "boolean";
  }
  return "string";
}
function consInterface(name: string, fields: ConsumptionField[]): string {
  return [
    `export interface ${name} {`,
    ...fields.map((f) => `  ${f.field}${f.required ? "" : "?"}: ${consTsType(f)};`),
    "}",
  ].join("\n");
}

/** The consumption-family `*Fields` interfaces. References `Scenario`/`AggregationKind`
 *  (hand-written app unions) from types.ts — a type-only cycle, erased at runtime. */
export function renderConsumption(): string {
  return `// GENERATED by \`deno task gen:interface\` — do not edit
//
// Consumption-family data interfaces derived from vocab/consumption.ttl via the
// field bridges in consumptionConfig.ts. Source of truth is the .ttl + that bridge;
// regenerate with \`deno task gen:interface\`. A freshness test guards drift.

import type { AggregationKind, Scenario } from "../../types.ts";

${consInterface("EnergyDatasetFields", ENERGY_DATASET_FIELDS)}

${consInterface("AggregationDefinitionFields", AGGREGATION_DEFINITION_FIELDS)}

${consInterface("AggregationSnapshotFields", AGGREGATION_SNAPSHOT_FIELDS)}
`;
}

function main(): void {
  const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const buildingOut = `${repoRoot}/src/services/rdf/buildingShape.generated.ts`;
  Deno.writeTextFileSync(buildingOut, render(parseVocab(repoRoot)));
  const consOut = `${repoRoot}/src/services/rdf/consumptionShape.generated.ts`;
  Deno.writeTextFileSync(consOut, renderConsumption());
  console.log(`Wrote ${buildingOut} and ${consOut}.`);
}

if (import.meta.main) main();
