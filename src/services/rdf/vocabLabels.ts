/**
 * Vocab-derived label lookup — the thin, hand-written read API over the generated
 * `VOCAB_LABELS` / `VOCAB_COMMENTS` maps (see the vocab-driven-labels plan). The
 * schema owns the intrinsic display metadata (label, comment); this resolves a
 * term IRI to its string in the active language.
 *
 * Kept deliberately dependency-light (only the generated maps + the locale store):
 * the field/option helpers that bridge `buildingConfig`/`roles` are added when the
 * UI sites migrate to read this — not here.
 */

import { type Lang, VOCAB_COMMENTS, VOCAB_LABELS } from "./vocabLabels.generated.ts";
import { getLanguage } from "../../lib/language.ts";

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
