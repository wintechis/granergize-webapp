import type { SpatialExtent } from "../../types.ts";
import { agsConceptUrl } from "../../constants/dataSources.ts";
import { nationalRegionUrl } from "../sources/regionGeometry.ts";

/**
 * Roll a set of buildings up to the finest region they ALL share — the spatial coordinate of an
 * aggregation (plan-aggregations Slice 2). Pure (network-free, fixture-tested); the per-building
 * Gemeinde AGS is resolved by the caller.
 *
 * The German AGS is itself the hierarchy: an 8-digit Gemeinde code nests under its 5-digit Kreis
 * under its 2-digit Land, so the shared region is just the longest AGS prefix common to every
 * building, snapped to a hierarchy boundary (8 → Gemeinde, 5 → Kreis, 2 → Land). A set spanning
 * several Bundesländer shares no Land-or-finer prefix but is still all-German, so it rolls up to
 * the **national** catch-all (NUTS-0 `DE`). Only a building without a clean 8-digit Gemeinde AGS
 * (non-German / unresolved) yields no region (`undefined`) — that aggregation stays ad-hoc.
 */
/** A NUTS/LAU hierarchy level an aggregation's extent can sit at — Gemeinde (LAU) → Kreis → Land
 *  (NUTS-1) → Bund (NUTS-0 `DE`, the national catch-all for members spanning several Länder). */
export type RegionLevel = "gemeinde" | "kreis" | "land" | "bund";

/** The hierarchy by AGS-prefix length (longest first); `bund` (len 0) matches any German set and is
 *  the NUTS `DE` concept, since AGS has no national code. `url(head)` builds the level's region IRI. */
const LEVELS: { len: number; level: RegionLevel; url: (head: string) => string }[] = [
  { len: 8, level: "gemeinde", url: agsConceptUrl },
  { len: 5, level: "kreis", url: agsConceptUrl },
  { len: 2, level: "land", url: agsConceptUrl },
  { len: 0, level: "bund", url: () => nationalRegionUrl() },
];

/**
 * Project a spatial extent to its 5-digit **Kreis** AGS for the Kreis choropleth (plan-aggregations
 * Slice 4): a Gemeinde (8-digit) or Kreis (5-digit) extent yields its 5-digit Kreis prefix; a
 * Land-only (2-digit) extent — or none — is too coarse for the Kreis layer and returns `null`
 * (the aggregation is then listed as "not placed"). Reads the AGS from the `…/ags/{code}` IRI.
 */
export function kreisAgsOf(extent: SpatialExtent | undefined): string | null {
  if (!extent) return null;
  const code = extent.region.match(/\/ags\/(\d+)$/)?.[1] ?? "";
  return code.length >= 5 ? code.slice(0, 5) : null;
}

/**
 * The region a set of Gemeinde AGS codes shares. Without `level`, the **finest** shared region
 * (longest common prefix snapped to a boundary — the Slice-2 auto behaviour). With `level`, only
 * that level is considered (Slice 6: a user-chosen grain) — returned only when all codes share its
 * prefix, else `undefined` (e.g. "Gemeinde" requested but the buildings span several → no extent).
 */
export function commonRegion(
  gemeindeAgs: string[],
  level?: RegionLevel,
): SpatialExtent | undefined {
  // Every member must contribute a full 8-digit Gemeinde AGS: a missing or malformed one means
  // the set can't be placed cleanly, so the whole aggregation declines a region rather than
  // guessing from a partial set.
  if (gemeindeAgs.length === 0) return undefined;
  if (!gemeindeAgs.every((a) => /^\d{8}$/.test(a))) return undefined;
  const candidates = level ? LEVELS.filter((l) => l.level === level) : LEVELS;
  for (const { len, level: lvl, url } of candidates) {
    const head = gemeindeAgs[0].slice(0, len);
    if (gemeindeAgs.every((a) => a.slice(0, len) === head)) {
      return { region: url(head), level: lvl };
    }
  }
  return undefined;
}
