/**
 * The schema-driven command-palette **parameter form** — pure core.
 *
 * Two pure decisions over the modelled param schema ({@link INTENT_PARAMS},
 * `intents/params.ts`), kept React-free so they are Tier-1 testable:
 *
 * - **{@link isFormEligible}** — can the ⌘K palette render a generic param form
 *   for this verb (and `invoke` it with no focused object)? True iff the verb has
 *   ≥1 modelled param, EVERY param is user-renderable (an IRI param whose range
 *   maps to a known picker, or a literal with a real, value-bearing datatype), and
 *   the verb is not in the opaque/bundle exclusion set (the rich verbs that own a
 *   bespoke dialog, and the `fileUri`+`subjectUri`-bundle verbs a single pick can't
 *   split).
 * - **{@link fieldKindFor}** — maps one param to the widget kind the form renders
 *   for it (building / agent / aggregation / room picker, or a boolean / year /
 *   text field), plus `multi` (cardinality `"many"`) and `required` (cardinality
 *   ≠ `"optional"`).
 *
 * The MUI form that consumes these is `components/IntentParamForm.tsx` (not
 * Tier-1-testable per CLAUDE.md — its render is covered by the palette e2e spec).
 */
import {
  FOAF_AGENT,
  LDP_RESOURCE,
  REC_BUILDING,
  XSD_BOOLEAN,
  XSD_GYEAR,
  XSD_STRING,
} from "../services/rdf/vocabularies.ts";
import {
  INTENT_PARAMS,
  type ParamIntentName,
  type ParamSpec,
} from "../intents/params.ts";

/** The widget a param renders as. */
export type FieldKind =
  | "building"
  | "agent"
  | "aggregation"
  | "room"
  | "boolean"
  | "year"
  | "text";

/** How one param renders: its widget kind plus cardinality-derived flags. */
export interface FieldDescriptor {
  /** The widget to render. */
  readonly kind: FieldKind;
  /** Multi-value pick/chips (cardinality `"many"`). */
  readonly multi: boolean;
  /** A value is required (cardinality ≠ `"optional"`). */
  readonly required: boolean;
}

/**
 * Verbs the generic form must NOT cover even though some of their params look
 * renderable:
 * - **Opaque/rich verbs** — a param stands in for a `File` / edited-field map /
 *   `EnergyDataset` / `SavedAgent` / fields object (a placeholder `XSD_STRING`), or
 *   the verb owns a rich bespoke dialog the palette routes to instead.
 * - **`fileUri`+`subjectUri` bundle verbs** — two internal IRIs of the *same*
 *   building that a single picker can't split into two distinct user picks.
 * - **Controlled-vocab text verbs** — a param IS a genuine `XSD_STRING` (so it
 *   would now render as a text field) but its value space is a controlled
 *   vocabulary that needs a *select*, not free text (`SaveRoles.roles` is a
 *   `UserRole`; it is set on the room page, and a proper role multi-select is a
 *   later refinement).
 *
 * Kept as an explicit set (not purely derived) because the bundle verbs' params
 * are individually renderable IRIs — only the *pair* is the problem — and an
 * opaque `XSD_STRING` placeholder is now indistinguishable, by datatype alone,
 * from a genuine free-text field (see {@link isRenderableParam}).
 */
export const FORM_EXCLUDED: ReadonlySet<string> = new Set<string>([
  // Opaque / rich-dialog verbs (their lone XSD_STRING is a File/Record/object
  // stand-in, or the verb owns a bespoke dialog).
  "CreateBuilding",
  "UpdateBuilding",
  "DeleteBuilding",
  "SaveObservation",
  "CreateAggregation",
  "SaveOrganisation",
  "UploadAttachments",
  "SaveAgent",
  "RestoreArchive",
  // FindBuildings.selector is a structured {and:[…]} object (placeholder XSD_STRING),
  // not a free-text field — the attribute facet UI renders it, not the generic form.
  "FindBuildings",
  // Read verbs: they return a value, not a form-submittable mutation. Their params
  // are renderable IRIs, but the generic param FORM is a write surface — reads reach
  // the launcher via the JSON/NL path, not a form.
  "GetBuilding",
  "GetObservationYear",
  "WhoHasAccess",
  // Open-tier federated reads (MaStR nearby / regionalstatistik) — reads too.
  "FindNearbyInstallations",
  "FindRegionalStatistics",
  // `fileUri` + `subjectUri` derived-IRI bundles.
  "SetEnergyCertificate",
  "DeleteAttachment",
  "DeleteObservation",
  "ClearObservations",
  "LinkObservationToBuilding",
  // Controlled-vocab text: `roles` is a UserRole vocab; set on the room page, a
  // proper role multi-select is a later refinement.
  "SaveRoles",
]);

/** IRI ranges that map to a known entity picker. */
const PICKER_IRI_RANGES: ReadonlySet<string> = new Set<string>([
  REC_BUILDING,
  FOAF_AGENT,
  LDP_RESOURCE,
]);

/**
 * Literal ranges that carry a genuine, renderable value (not an opaque object).
 * `XSD_STRING` is a genuine free-text field: within a non-{@link FORM_EXCLUDED}
 * verb the truly-opaque `File`/`Record`/object stand-ins (and the controlled-vocab
 * text verbs) are already removed, so any remaining `XSD_STRING` param is a real
 * text value (e.g. `AddBookmark.input`, an invite link or room URI). `resolveKind`
 * maps it to a `"text"` field.
 */
const VALUE_LITERAL_RANGES: ReadonlySet<string> = new Set<string>([
  XSD_BOOLEAN,
  XSD_GYEAR,
  XSD_STRING,
]);

/**
 * Is this single param user-renderable as a form field? An IRI param whose range
 * maps to a known picker, the `aggregationId` literal (a literal-but-identity that
 * an aggregation picker yields), or a literal with a real, value-bearing datatype
 * — including `XSD_STRING`, which renders as a free-text field. The opaque
 * `XSD_STRING` placeholders (File/Record/object stand-ins) and controlled-vocab
 * text verbs are screened out at the verb level by {@link FORM_EXCLUDED}, so a
 * surviving `XSD_STRING` param is a genuine text value.
 */
function isRenderableParam(paramName: string, spec: ParamSpec): boolean {
  if (spec.nodeKind === "iri") return PICKER_IRI_RANGES.has(spec.range);
  // Literal: a genuine value datatype, or the aggregationId literal-identity.
  if (paramName === "aggregationId") return true;
  return VALUE_LITERAL_RANGES.has(spec.range);
}

/**
 * Can the palette render a generic parameter form for this verb? True iff it is
 * not excluded, has ≥1 modelled param, and every param is renderable. A pure
 * predicate over {@link INTENT_PARAMS} — the basis for the palette's form-step
 * routing.
 *
 * The **v1 form-eligible set** this yields: `ShareBuilding`, `ShareAggregation`,
 * `RevokeBuildingAccess`, `RevokeAggregationAccess`, `ToggleVisibility`,
 * `RemoveAgent`, `DeleteAggregation`, `RefreshAggregation`, `CreateRoom` (its
 * optional `name`), `EnterRoom`, `ExitRoom`, `DeleteRoom`, `RemoveBookmark`, and
 * `AddBookmark` (its `input` is a genuine free-text invite-link / room-URI field).
 */
export function isFormEligible(name: string): boolean {
  if (FORM_EXCLUDED.has(name)) return false;
  const schema = (INTENT_PARAMS as Record<string, Record<string, ParamSpec>>)[
    name
  ];
  if (!schema) return false;
  const entries = Object.entries(schema);
  if (entries.length === 0) return false;
  return entries.every(([param, spec]) => isRenderableParam(param, spec));
}

/** The exact set of catalog names {@link isFormEligible} accepts (derived). */
export function formEligibleNames(): string[] {
  return (Object.keys(INTENT_PARAMS) as ParamIntentName[]).filter(isFormEligible);
}

/**
 * Map one param to its form widget. The IRI ambiguity is resolved by **context**:
 * `REC_BUILDING` → building, `FOAF_AGENT` → agent, and the otherwise-ambiguous
 * `LDP_RESOURCE` splits by the param NAME — `snapshotUri` is an aggregation
 * snapshot (→ aggregation picker, which derives the snapshot IRI), while
 * `roomUri`/`room` is a data-room container (→ room picker). The `aggregationId`
 * literal-identity also maps to the aggregation picker.
 */
export function fieldKindFor(
  intentName: string,
  paramName: string,
  spec: ParamSpec,
): FieldDescriptor {
  const multi = spec.cardinality === "many" || spec.cardinality === "any";
  const required = spec.cardinality === "one" || spec.cardinality === "many";
  const kind = resolveKind(intentName, paramName, spec);
  return { kind, multi, required };
}

function resolveKind(
  _intentName: string,
  paramName: string,
  spec: ParamSpec,
): FieldKind {
  if (spec.nodeKind === "iri") {
    if (spec.range === REC_BUILDING) return "building";
    if (spec.range === FOAF_AGENT) return "agent";
    // LDP_RESOURCE is ambiguous by range alone → split by the param name:
    // a snapshot IRI vs a room-container IRI.
    if (paramName === "snapshotUri") return "aggregation";
    if (paramName === "roomUri" || paramName === "room") return "room";
    // Fall through for any other LDP_RESOURCE param (none in the v1 set).
    return "text";
  }
  // Literal params.
  if (paramName === "aggregationId") return "aggregation";
  if (spec.range === XSD_BOOLEAN) return "boolean";
  if (spec.range === XSD_GYEAR) return "year";
  return "text";
}
