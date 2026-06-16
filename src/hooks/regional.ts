/**
 * Regional-context query: a building's German region figures from
 * `linked-regionalstatistik` (an RDF Data Cube). A **queried, off-Pod** external
 * observation (no Solid session, no WebID scoping), so a plain `useQuery` — not
 * the WebID-scoped Pod hooks in `queries.ts`.
 *
 * Best-effort: the wrapper is an external host that may be down or CORS-blocked,
 * so the fetch is caught and degraded to `null` rather than thrown — otherwise the
 * central `QueryCache.onError` toast would fire for a non-critical context layer.
 * The request still shows in the global activity indicator (via `trackedFetch`).
 */
import { useQuery } from "@tanstack/react-query";
import type { BuildingType } from "../types.ts";
import { bundeslandToAgs } from "../services/region.ts";
import {
  fetchRegionalObservations,
  REGIONAL_TABLES,
  type RegionalObservation,
  type RegionalTable,
} from "../services/rdf/regionalCube.ts";
import { logError } from "../lib/logError.ts";

export interface RegionalMetric {
  table: RegionalTable;
  observations: RegionalObservation[];
  /** Most recent year's figure (the headline), or null if the table had none. */
  latest: RegionalObservation;
}

export interface RegionalContext {
  /** The building's Bundesland name (display). */
  region: string;
  /** Its 2-digit AGS (the cube's geo code). */
  ags: string;
  metrics: RegionalMetric[];
}

/**
 * Regional figures for a building, joined at Bundesland grain from its `region`
 * field. `data` is `null` when the building has no recognised German region (the
 * query stays disabled) or when every table fetch failed/was empty. Hour-long
 * `staleTime` — regional statistics change at most yearly.
 */
export function useRegionalContext(building: BuildingType) {
  const region = building.region ?? "";
  const ags = bundeslandToAgs(region);
  return useQuery<RegionalContext | null>({
    queryKey: ["regionalContext", ags, region],
    enabled: Boolean(ags),
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      if (!ags) return null;
      const landTables = REGIONAL_TABLES.filter((t) => t.grain === "land");
      const metrics: RegionalMetric[] = [];
      for (const table of landTables) {
        try {
          const observations = await fetchRegionalObservations(table.tableId, ags);
          if (observations.length) {
            metrics.push({ table, observations, latest: observations.at(-1)! });
          }
        } catch (err) {
          // Best-effort: one table failing must not sink the section or toast.
          logError(`fetch regional table ${table.tableId}`, err);
        }
      }
      return metrics.length ? { region, ags, metrics } : null;
    },
  });
}
