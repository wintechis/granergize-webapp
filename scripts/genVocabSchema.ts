/**
 * Codegen: parse the three owned `vocab/*.ttl` ontologies and emit
 * `src/services/rdf/vocabSchema.generated.ts` — a per-property IRI schema
 * (range / datatype / enum-or-structured classification / functional-cardinality
 * / optional canonical unit) parsed from the vocab.
 *
 * Sibling of `genVocabLabels.ts` (labels) — same "schema owns the metadata" stance:
 * the app reads this instead of restating `rdfs:range` in `buildingConfig`. Run via
 * `deno task gen:schema`; a freshness test (`vocabSchema.test.ts`) regenerates in
 * memory and asserts equality with the committed file, so it can't drift.
 *
 * Classification of a property by its `rdfs:range`:
 *   - an XSD datatype          → `kind: "literal"` (+ the datatype local name)
 *   - `foaf:Agent`             → `kind: "agent"`   (a WebID, stored verbatim)
 *   - a class WITH instances   → `kind: "enum"`    (controlled vocab; instances listed)
 *   - a class WITHOUT instances→ `kind: "structured"` (a node shape; the app parses it by hand)
 *   - no/unknown range         → `kind: "literal"` (xsd:string default), like the app today
 */

import { Parser } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
const RDFS_CLASS = "http://www.w3.org/2000/01/rdf-schema#Class";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_DATATYPE_PROP = "http://www.w3.org/2002/07/owl#DatatypeProperty";
const OWL_OBJECT_PROP = "http://www.w3.org/2002/07/owl#ObjectProperty";
const OWL_FUNCTIONAL = "http://www.w3.org/2002/07/owl#FunctionalProperty";
const SOSA_OBSERVABLE = "http://www.w3.org/ns/sosa/ObservableProperty";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
const FOAF_AGENT = "http://xmlns.com/foaf/0.1/Agent";
const CONS_NS = "https://solid.ti.rw.fau.de/gra/consumption.ttl#";
const CANONICAL_UNIT = `${CONS_NS}canonicalUnit`;

/** Namespace IRI → vocab file, relative to repo root (mirrors genVocabLabels). */
export const NS_FILE: Record<string, string> = {
  "https://solid.ti.rw.fau.de/gra/vocab.ttl#": "vocab/vocab.ttl",
  "https://solid.ti.rw.fau.de/gra/building.ttl#": "vocab/building.ttl",
  "https://solid.ti.rw.fau.de/gra/consumption.ttl#": "vocab/consumption.ttl",
};

export type TermKind = "literal" | "agent" | "enum" | "structured";

export interface TermSchema {
  kind: TermKind;
  /** XSD datatype local name for `kind: "literal"` (e.g. "integer", "decimal", "gYear"). */
  datatype?: string;
  /** The `rdfs:range` IRI, when declared. */
  range?: string;
  /** `owl:FunctionalProperty` → single-valued (else treat as possibly multi). */
  functional: boolean;
  /** Instance IRIs for `kind: "enum"` (the controlled-vocab values), sorted. */
  instances?: string[];
  /** `cons:canonicalUnit` IRI, when declared (energy observable properties). */
  unit?: string;
}

interface Raw {
  types: Map<string, Set<string>>; // subject → its rdf:type objects
  ranges: Map<string, string>; // property → rdfs:range
  units: Map<string, string>; // property → cons:canonicalUnit
}

/** Fold one Turtle document's relevant quads into the running raw maps. */
export function collectFromTurtle(ttl: string, baseIRI: string, raw: Raw): void {
  const quads = new Parser({ baseIRI }).parse(ttl);
  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    if (p === RDF_TYPE) {
      (raw.types.get(s) ?? raw.types.set(s, new Set()).get(s)!).add(q.object.value);
    } else if (p === RDFS_RANGE) {
      raw.ranges.set(s, q.object.value);
    } else if (p === CANONICAL_UNIT) {
      raw.units.set(s, q.object.value);
    }
  }
}

/** Build the per-property schema map from all owned vocab files. */
export function generateSchema(repoRoot: string): Record<string, TermSchema> {
  const raw: Raw = { types: new Map(), ranges: new Map(), units: new Map() };
  for (const [ns, file] of Object.entries(NS_FILE)) {
    collectFromTurtle(Deno.readTextFileSync(`${repoRoot}/${file}`), ns.slice(0, -1), raw);
  }

  const isProperty = (t: Set<string>) =>
    t.has(OWL_DATATYPE_PROP) || t.has(OWL_OBJECT_PROP) || t.has(SOSA_OBSERVABLE);
  const isClass = (iri: string) => {
    const t = raw.types.get(iri);
    return !!t && (t.has(RDFS_CLASS) || t.has(OWL_CLASS));
  };
  // Classes that have at least one declared instance (= controlled-vocab enums).
  const enumClasses = new Map<string, string[]>();
  for (const [s, types] of raw.types) {
    for (const t of types) {
      if (isClass(t)) (enumClasses.get(t) ?? enumClasses.set(t, []).get(t)!).push(s);
    }
  }

  const out: Record<string, TermSchema> = {};
  for (const [iri, types] of raw.types) {
    if (!isProperty(types)) continue;
    const range = raw.ranges.get(iri);
    const functional = types.has(OWL_FUNCTIONAL);
    const unit = raw.units.get(iri);
    let schema: TermSchema;
    if (!range || range.startsWith(XSD_NS)) {
      schema = {
        kind: "literal",
        datatype: range?.startsWith(XSD_NS) ? range.slice(XSD_NS.length) : "string",
        range,
        functional,
      };
    } else if (range === FOAF_AGENT) {
      schema = { kind: "agent", range, functional };
    } else if (enumClasses.has(range)) {
      schema = { kind: "enum", range, functional, instances: enumClasses.get(range)!.sort() };
    } else {
      schema = { kind: "structured", range, functional };
    }
    if (unit) schema.unit = unit;
    out[iri] = schema;
  }
  return out;
}

/** Render the schema map as a deterministic (key-sorted) TS object literal. */
function serialize(schema: Record<string, TermSchema>): string {
  const lines = Object.keys(schema).sort().map((iri) => {
    const s = schema[iri];
    const parts = [`kind: ${JSON.stringify(s.kind)}`];
    if (s.datatype) parts.push(`datatype: ${JSON.stringify(s.datatype)}`);
    if (s.range) parts.push(`range: ${JSON.stringify(s.range)}`);
    parts.push(`functional: ${s.functional}`);
    if (s.instances) parts.push(`instances: [${s.instances.map((i) => JSON.stringify(i)).join(", ")}]`);
    if (s.unit) parts.push(`unit: ${JSON.stringify(s.unit)}`);
    return `  ${JSON.stringify(iri)}: { ${parts.join(", ")} },`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

export function renderModule(schema: Record<string, TermSchema>): string {
  return `// GENERATED by \`deno task gen:schema\` — do not edit
//
// Per-property schema parsed from vocab/*.ttl: range, datatype, enum/structured
// classification, functional cardinality, optional canonical unit. Source of truth
// is the .ttl files; regenerate with \`deno task gen:schema\`. A freshness test guards drift.

export type TermKind = "literal" | "agent" | "enum" | "structured";

export interface TermSchema {
  kind: TermKind;
  datatype?: string;
  range?: string;
  functional: boolean;
  instances?: string[];
  unit?: string;
}

export const VOCAB_SCHEMA: Record<string, TermSchema> =
  ${serialize(schema)};
`;
}

function main(): void {
  const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = generateSchema(repoRoot);
  const out = `${repoRoot}/src/services/rdf/vocabSchema.generated.ts`;
  Deno.writeTextFileSync(out, renderModule(schema));
  console.log(`Wrote ${out}: ${Object.keys(schema).length} properties.`);
}

if (import.meta.main) main();
