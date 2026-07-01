import type { Building } from "../types.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import type { MessageId, MessageParams } from "./messages.ts";
import { buildingIdStem } from "../services/rdf/building/buildingId.ts";

/**
 * A building's display name: its label, else its code, else its street address,
 * else "Building <stem>". The stem is a verbatim part of the building's IRI
 * (file stem or fragment), so a label never names an id that differs from the
 * building's IRI (heike-5 #1) — display only, never an identifier.
 */
export function buildingDisplayName(b: Building): string {
  return b.label || b.buildingCode || b.streetAddress ||
    `Building ${buildingIdStem(b.id)}`;
}

/** One-line address ("Street, 12345 City"), omitting the parts that are unset. */
export function buildingAddressLine(b: Building): string {
  const cityLine = [b.postalCode, b.locality].filter(Boolean).join(" ");
  return [b.streetAddress, cityLine].filter(Boolean).join(", ");
}

/**
 * The text a building matches keyword search against (shared by the Buildings and
 * Observations finders): its display name plus the address, region, customer,
 * company and code — i.e. everything a user might scan/type to find it.
 */
export function buildingSearchText(b: Building): string {
  return [
    buildingDisplayName(b),
    buildingAddressLine(b),
    b.region,
    b.customer,
    b.companyName,
    b.buildingCode,
  ].filter(Boolean).join(" ");
}

/**
 * A short read-out of the years (and resolution) a building has observations
 * for — "3 years (2022–2024) · annual + time series". Locale-driven: the
 * caller passes its translate function (`useT()`'s `t` in render), so the
 * plural form and the kind label follow the active language instead of a
 * hand-rolled English `"year" + "s"`.
 */
export function datasetSummary(
  b: Building,
  tr: (id: MessageId, params?: MessageParams) => string,
): string {
  const refs = b.energyDatasets ?? [];
  const years = [...new Set(refs.map((d) => d.year))].sort((a, c) => a - c);
  if (years.length === 0) return "";
  const range = years.length === 1
    ? String(years[0])
    : `${years[0]}–${years[years.length - 1]}`;
  const hasSeries = refs.some((d) => isSeriesGranularity(d.granularity));
  return tr("obsDatasetSummary", {
    count: years.length,
    range,
    kind: tr(hasSeries ? "obsKindAnnualPlusSeries" : "obsKindAnnual"),
  });
}
