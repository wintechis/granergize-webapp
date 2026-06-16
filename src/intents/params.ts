/**
 * The typed **parameter schema** for the invocable intents — the reified
 * node-kind / range / cardinality of each modelled param.
 *
 * A separate module from {@link IntentAffordance} (`affordances.ts`): the lean
 * affordance table stays a flat `params: string[]` bag (its drift guard is
 * against the hook vars), while THIS module records the RDF shape of each param —
 * whether it is an IRI reference or a literal, its class/datatype range, and its
 * cardinality. The schema binds against the cores' TS param types via the
 * compile-time {@link ParamKeysMatch} witness (the field-name set, minus
 * runtime-only handles like `signal`).
 *
 * **Step-4 seam:** the `nodeKind: "iri"` markers tell the future EntityQuery
 * resolver which params (`buildingUri`, `recipients`) need IRI→instance
 * resolution *before* `invoke()`; the `"literal"` ones are passed through.
 */
import {
  FOAF_AGENT,
  REC_BUILDING,
  XSD_BOOLEAN,
  XSD_GYEAR,
} from "../services/rdf/vocabularies.ts";
import type { CoreParams, ReadIntentName, WriteIntentName } from "./registry.ts";

/** An RDF node kind: an IRI reference (resolvable to an instance) vs a literal. */
export type NodeKind = "iri" | "literal";

/** How many values a param takes. */
export type Cardinality = "one" | "optional" | "many";

/** The reified RDF shape of one intent parameter. */
export interface ParamSpec {
  /** IRI reference (resolvable) vs. literal value. */
  readonly nodeKind: NodeKind;
  /** The param's range — a class IRI (for `iri`) or an XSD datatype IRI (for `literal`). */
  readonly range: string;
  /** How many values the param takes. */
  readonly cardinality: Cardinality;
}

/** A param schema: field name → its reified RDF shape. */
export type ParamSchema = Readonly<Record<string, ParamSpec>>;

/**
 * Reified param schemas keyed by the catalog intent `name`. Only the invocable
 * intents (those with an extracted core) are populated; Step 5 adds one entry per
 * newly-extracted core. Runtime-only handles (`signal`) are NOT modelled here —
 * they are an abort affordance, not an RDF param.
 */
export const INTENT_PARAMS = {
  ShareBuilding: {
    buildingUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    recipients: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "many" },
    includeEnergyData: { nodeKind: "literal", range: XSD_BOOLEAN, cardinality: "one" },
    years: { nodeKind: "literal", range: XSD_GYEAR, cardinality: "many" },
  },
  ExportArchive: {},
  AuditGrants: {},
} as const satisfies Record<string, ParamSchema>;

/** A catalog name with a reified param schema. */
export type ParamIntentName = keyof typeof INTENT_PARAMS;

// ── Compile-time key-set witness ──────────────────────────────────────────────
// Lightweight binding to the core arg type: assert the schema's field names equal
// the core's param keys MINUS runtime-only fields (`signal`). Catches a core
// gaining/renaming a param. We do NOT attempt full structural value-typing — TS
// can't express IRI-ness, so the rigour wouldn't pay.

/** Param keys that are runtime-only handles, never modelled in the schema. */
type RuntimeOnlyKey = "signal";

/** The modelled key set of a core's param object (runtime-only keys stripped). */
type ModelledCoreKeys<N extends ParamIntentName> = N extends
  WriteIntentName | ReadIntentName
  ? Exclude<keyof CoreParams<N>, RuntimeOnlyKey>
  : never;

/**
 * `true` iff `INTENT_PARAMS[N]`'s field-name set exactly equals the core's
 * modelled param keys. Used as a type-level assertion below — any mismatch makes
 * the corresponding entry resolve to `false` and breaks the build.
 */
export type ParamKeysMatch<N extends ParamIntentName> =
  [keyof (typeof INTENT_PARAMS)[N]] extends [ModelledCoreKeys<N>]
    ? [ModelledCoreKeys<N>] extends [keyof (typeof INTENT_PARAMS)[N]] ? true
    : false
    : false;

/**
 * Build-time assertion that every populated schema's keys match its core's
 * modelled params. A `false` here is a type error (the build runs the check).
 */
const _paramKeysMatch: {
  [N in ParamIntentName]: ParamKeysMatch<N>;
} = {
  ShareBuilding: true,
  ExportArchive: true,
  AuditGrants: true,
};
void _paramKeysMatch;
