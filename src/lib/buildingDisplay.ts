import type { BuildingType } from "../types.ts";
import { buildingIdStem } from "../services/rdf/building/buildingId.ts";

/**
 * A building's display name: its label, else its code, else its street address,
 * else "Building <stem>". The stem is a verbatim part of the building's IRI
 * (file stem or fragment), so a label never names an id that differs from the
 * building's IRI (heike-5 #1) — display only, never an identifier.
 */
export function buildingDisplayName(b: BuildingType): string {
  return b.label || b.buildingCode || b.streetAddress ||
    `Building ${buildingIdStem(b.id)}`;
}

/** One-line address ("Street, 12345 City"), omitting the parts that are unset. */
export function buildingAddressLine(b: BuildingType): string {
  const cityLine = [b.postalCode, b.locality].filter(Boolean).join(" ");
  return [b.streetAddress, cityLine].filter(Boolean).join(", ");
}
