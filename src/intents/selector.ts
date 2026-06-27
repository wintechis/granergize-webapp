/**
 * The attribute **selector** — the structured, vocab-grounded query language for
 * narrowing a building collection (`plans/plan-attribute-facets.md`). A selector is
 * an AND-conjunction of `{ field, op, value }` constraints over the building field
 * schema (`buildingConfig.ts`), evaluated as a **pure predicate** over the
 * already-loaded set — no Pod/SPARQL. It is the local mode of the EntityQuery
 * forward resolver; `FindBuildings` filters with it, and the LLM emits it as
 * `params.selector` (the prompt lists the fields via {@link selectorFieldsSpec}).
 *
 * React-free and dependency-light so it serves four consumers at once: the finder,
 * the URI, the command box / LLM, and a macro step.
 */
import type { Building } from "../types.ts";
import { BUILDING_FIELDS, schemaFor } from "../services/rdf/building/buildingConfig.ts";

/** The kind of a filterable field — decides which ops/values apply. */
export type FieldKind = "numeric" | "boolean" | "text";

/** A comparison operator. Numeric: lt/le/gt/ge/eq/ne; text/enum: eq/ne/contains/in;
 * any field: has/lacks (presence). */
export type Op =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "contains"
  | "in"
  | "has"
  | "lacks";

/** One constraint: a field, an operator, and (for non-presence ops) a value. */
export interface Constraint {
  readonly field: string;
  readonly op: Op;
  readonly value?: string | number | boolean | ReadonlyArray<string | number>;
}

/** A selector: a conjunction (AND) of constraints. Empty `and` ⇒ no narrowing. */
export interface Selector {
  readonly and: ReadonlyArray<Constraint>;
}

/** field name → kind, derived ONCE from the building schema's `rdfs:range`
 *  (via the vocab-sourced {@link schemaFor}). */
export const FIELD_KIND: ReadonlyMap<string, FieldKind> = new Map(
  BUILDING_FIELDS.map((f) => {
    const dt = schemaFor(f.iri).datatype;
    // agent (IRI) and controlled-vocab/string ranges are all matched as text.
    const kind: FieldKind = dt === "integer" || dt === "decimal"
      ? "numeric"
      : dt === "boolean"
      ? "boolean"
      : "text";
    return [String(f.field), kind] as const;
  }),
);

const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== "" && v !== false;

const lower = (v: unknown): string => String(v).trim().toLowerCase();

/** Coerce a stored value (possibly a string) to a number; NaN if not numeric. */
const num = (v: unknown): number =>
  typeof v === "number" ? v : Number(String(v).replace(",", "."));

/** Boolean coercion tolerant of the string form a parsed Pod value may carry. */
const bool = (v: unknown): boolean => v === true || lower(v) === "true";

function eqValue(raw: unknown, value: Constraint["value"]): boolean {
  if (typeof value === "boolean") return bool(raw) === value;
  if (typeof value === "number") return num(raw) === value;
  return lower(raw) === lower(value);
}

/** Does one constraint hold for a building? Unknown field ⇒ false (conservative). */
export function matchConstraint(b: Building, c: Constraint): boolean {
  const raw = (b as unknown as Record<string, unknown>)[c.field];
  switch (c.op) {
    case "has":
      return present(raw);
    case "lacks":
      return !present(raw);
    case "in": {
      const set = Array.isArray(c.value) ? c.value.map(lower) : [lower(c.value)];
      return present(raw) && set.includes(lower(raw));
    }
    case "contains":
      return present(raw) && lower(raw).includes(lower(c.value));
    case "eq":
      return present(raw) && eqValue(raw, c.value);
    case "ne":
      return !present(raw) || !eqValue(raw, c.value);
    case "lt":
    case "le":
    case "gt":
    case "ge": {
      const a = num(raw), v = num(c.value);
      if (Number.isNaN(a) || Number.isNaN(v)) return false;
      return c.op === "lt" ? a < v : c.op === "le" ? a <= v : c.op === "gt" ? a > v : a >= v;
    }
  }
}

/** Does the building satisfy EVERY constraint? Empty selector ⇒ true. */
export function matches(b: Building, sel: Selector): boolean {
  return sel.and.every((c) => matchConstraint(b, c));
}

/** Filter a building set by a selector (the in-hand local mode). */
export function filter(
  buildings: ReadonlyArray<Building>,
  sel: Selector,
): Building[] {
  return buildings.filter((b) => matches(b, sel));
}

/** The filterable fields grouped by kind — the basis for the LLM prompt + a UI
 * field picker. Derived from the live schema so it can't drift. */
export function fieldsByKind(): Record<FieldKind, string[]> {
  const out: Record<FieldKind, string[]> = { numeric: [], boolean: [], text: [] };
  for (const [field, kind] of FIELD_KIND) out[kind].push(field);
  return out;
}

/** A compact spec of the selector fields for the LLM system prompt. */
export function selectorFieldsSpec(): string {
  const g = fieldsByKind();
  return [
    "Building filter fields for FindBuildings — params.selector is",
    '{"and":[{"field","op","value"}]} (AND of constraints). Ops by field kind:',
    `- numeric (ops lt,le,eq,ne,ge,gt): ${g.numeric.join(", ")}`,
    `- boolean (ops has,lacks,eq with true/false): ${g.boolean.join(", ")}`,
    `- text/enum (ops eq,ne,contains,in,has,lacks): ${g.text.join(", ")}`,
  ].join("\n");
}

/** Normalise a constraint to a comparable key (field|op|value), value-normalised. */
function constraintKey(c: Constraint): string {
  const v = c.op === "has" || c.op === "lacks"
    ? ""
    : Array.isArray(c.value)
    ? [...c.value].map(lower).sort().join(",")
    : lower(c.value);
  return `${lower(c.field)}|${c.op}|${v}`;
}

/** Coerce a loosely-shaped value (an array, or `{and:[…]}`) to a constraint list. */
function constraintsOf(sel: unknown): Constraint[] {
  const arr = Array.isArray(sel)
    ? sel
    : (sel && typeof sel === "object" && Array.isArray((sel as { and?: unknown }).and))
    ? (sel as { and: unknown[] }).and
    : [];
  return arr.filter((c): c is Constraint =>
    !!c && typeof c === "object" && typeof (c as Constraint).field === "string"
  );
}

/** Structural equality of two selectors as constraint SETS (order-insensitive) —
 * the eval's gold-vs-produced comparator. Tolerates `{and:[…]}` or a bare array. */
export function selectorEquals(a: unknown, b: unknown): boolean {
  const ka = constraintsOf(a).map(constraintKey).sort();
  const kb = constraintsOf(b).map(constraintKey).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}
