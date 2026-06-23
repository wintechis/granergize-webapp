/**
 * Unit handling for energy metrics — the conversion + labels that let a building carry
 * its data in a non-canonical unit (e.g. MWh) without the silent misread the model used
 * to have (it pinned one canonical unit per metric and ignored the per-observation
 * `ssn:hasUnit`). See plans/plan-variable-units.md.
 *
 * The numeric layer stays **canonical** (kWh / m³ / %): the parser normalises a foreign
 * value to the canonical unit (`toCanonical`) so every downstream calculation
 * (intensity, terciles, trend, aggregation, the cube) is unaffected. The original unit
 * is kept only to DISPLAY it back (`fromCanonical` + `unitLabel`) on per-building
 * surfaces and the export. QUDT unit IRIs under {@link UNIT_NS}.
 */
import { UNIT_NS } from "../rdf/vocabularies.ts";

/** Canonical unit's local name → { source local name: factor (× = canonical), label }. */
const FAMILIES: Record<
  string,
  Record<string, { factor: number; label: string }>
> = {
  "KiloW-HR": {
    "KiloW-HR": { factor: 1, label: "kWh" },
    "MegaW-HR": { factor: 1_000, label: "MWh" },
    "GigaW-HR": { factor: 1_000_000, label: "GWh" },
    "W-HR": { factor: 0.001, label: "Wh" },
  },
  "M3": {
    "M3": { factor: 1, label: "m³" },
    "L": { factor: 0.001, label: "L" },
  },
  "PERCENT": {
    "PERCENT": { factor: 1, label: "%" },
  },
};

/** The local name of a unit IRI (the QUDT-vocab suffix, or the last path/fragment part). */
function local(iri: string): string {
  if (iri.startsWith(UNIT_NS)) return iri.slice(UNIT_NS.length);
  return iri.split(/[#/]/).pop() ?? iri;
}

/**
 * Convert `value` (in `unitIri`) to the `canonicalIri` unit. A missing/empty `unitIri` is
 * assumed canonical (our own data always writes the canonical unit). Returns **null** when
 * `unitIri` is a non-canonical unit NOT recognised as a sibling of the canonical — so the
 * caller can skip the observation rather than show a silently-wrong number.
 */
export function toCanonical(
  value: number,
  unitIri: string | undefined,
  canonicalIri: string,
): number | null {
  const fam = FAMILIES[local(canonicalIri)];
  if (!fam) return value; // a metric with no conversion family — pass through
  if (!unitIri) return value; // unit absent → assume canonical
  const entry = fam[local(unitIri)];
  return entry ? value * entry.factor : null;
}

/** Convert a canonical value back into `unitIri` for display; unchanged when unknown. */
export function fromCanonical(
  canonicalValue: number,
  unitIri: string,
  canonicalIri: string,
): number {
  const entry = FAMILIES[local(canonicalIri)]?.[local(unitIri)];
  return entry ? canonicalValue / entry.factor : canonicalValue;
}

/** Whether two unit IRIs denote the same unit (compared by local name, so a relative and
 *  absolute form of the same QUDT unit match). */
export function sameUnit(a: string, b: string): boolean {
  return local(a) === local(b);
}

/** Display label ("kWh"/"MWh"/"m³"/"L"/"%") for a unit IRI, or "" if unknown. */
export function unitLabel(unitIri: string): string {
  const u = local(unitIri);
  for (const fam of Object.values(FAMILIES)) {
    if (fam[u]) return fam[u].label;
  }
  return "";
}

/**
 * The value + label to SHOW for a canonical metric value, given the dataset's recorded raw
 * unit (if any): the canonical unit + value when there's no raw unit (the common case), or
 * the value converted back into the raw unit + its label. The single helper every
 * per-building display surface uses.
 */
export function displayMetric(
  canonicalValue: number,
  rawUnitIri: string | undefined,
  canonicalIri: string,
): { value: number; label: string } {
  if (!rawUnitIri || local(rawUnitIri) === local(canonicalIri)) {
    return { value: canonicalValue, label: unitLabel(canonicalIri) };
  }
  return {
    value: fromCanonical(canonicalValue, rawUnitIri, canonicalIri),
    label: unitLabel(rawUnitIri),
  };
}
