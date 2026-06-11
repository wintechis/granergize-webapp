import type { BuildingType } from "../types.ts";

/**
 * A building's display name: its label, else its code, else its street address,
 * else "Building <id>". The id fallback shows the IRI-extracted id verbatim, so
 * a label never names an id that differs from the building's IRI (heike-5 #1).
 */
export function buildingDisplayName(b: BuildingType): string {
  return b.label || b.buildingCode || b.streetAddress || `Building ${b.id}`;
}

/** One-line address ("Street, 12345 City"), omitting the parts that are unset. */
export function buildingAddressLine(b: BuildingType): string {
  const cityLine = [b.postalCode, b.locality].filter(Boolean).join(" ");
  return [b.streetAddress, cityLine].filter(Boolean).join(", ");
}
