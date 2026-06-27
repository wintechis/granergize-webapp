/**
 * Vocab-derived label lookup — the thin, hand-written read API over the generated
 * `VOCAB_LABELS` / `VOCAB_COMMENTS` maps (see the vocab-driven-labels plan). The
 * schema owns the intrinsic display metadata (label, comment); this resolves a
 * term IRI to its string in the active language.
 *
 * Kept deliberately dependency-light (only the generated maps + the locale store,
 * plus `buildingConfig` as the field→IRI source of truth for {@link fieldLabel}).
 */

import { type Lang, VOCAB_COMMENTS, VOCAB_LABELS } from "./vocabLabels.generated.ts";
import { getLanguage } from "../../lib/language.ts";
import { BUILDING_FIELDS } from "./building/buildingConfig.ts";
import type { Building } from "../../types.ts";

/** The local-name fragment of an IRI: after the last `#` or `/`. */
function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const cut = Math.max(hash, slash);
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

/**
 * Human-readable label for a term IRI in the active (or given) language.
 * Fallback chain: chosen language → English → the IRI's local-name fragment, so
 * a partially-translated vocab still renders. For owned terms the per-language
 * completeness guard keeps the last hop unreachable.
 */
export function label(iri: string, lang: Lang = getLanguage()): string {
  const byLang = VOCAB_LABELS[iri];
  return byLang?.[lang] ?? byLang?.en ?? localName(iri);
}

/**
 * Description for a term IRI in the active (or given) language, or `undefined`
 * if the vocab carries no comment for it. Falls back chosen → English.
 */
export function comment(iri: string, lang: Lang = getLanguage()): string | undefined {
  const byLang = VOCAB_COMMENTS[iri];
  return byLang?.[lang] ?? byLang?.en;
}

/** Building field key → its predicate IRI, derived from `buildingConfig`'s schema table. */
const FIELD_IRI: Partial<Record<keyof Building, string>> = Object.fromEntries(
  BUILDING_FIELDS.map((f) => [f.field, f.iri]),
);

/**
 * Label for a building field, resolved via its predicate IRI in `buildingConfig`
 * (the field→IRI source of truth) and the vocab labels. Same fallback chain as
 * {@link label}; a field with no schema IRI falls back to the bare field name.
 */
export function fieldLabel(
  field: keyof Building,
  lang: Lang = getLanguage(),
): string {
  const iri = FIELD_IRI[field];
  return iri ? label(iri, lang) : String(field);
}

/**
 * Label for a controlled-vocabulary instance IRI (e.g. `…#OneShift`). A thin
 * wrapper over {@link label}, present for call-site clarity/symmetry with
 * {@link fieldLabel}.
 */
export function optionLabel(iri: string, lang: Lang = getLanguage()): string {
  return label(iri, lang);
}
