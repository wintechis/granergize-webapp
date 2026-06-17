/**
 * Regional-context query: a building's German region figures from
 * `linked-regionalstatistik` (an RDF Data Cube). A **queried, off-Pod** external
 * observation (no Solid session, no WebID scoping), so a plain `useQuery` — not
 * the WebID-scoped Pod hooks in `queries.ts`.
 *
 * Two grains are joined: **Bundesland** tables from the building's `region` field
 * (via {@link bundeslandToAgs}), and **Kreis** tables from the building's Kreis —
 * reverse-geocoded from nearby MaStR units ({@link useNearbyInstallations}), since
 * the geo wrappers expose no point-in-polygon endpoint.
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
  fetchKreisName,
  fetchRegionalObservations,
  REGIONAL_TABLES,
  type RegionalObservation,
  type RegionalTable,
} from "../services/rdf/regionalCube.ts";
import { useNearbyInstallations } from "./mastrNearby.ts";
import { logError } from "../lib/logError.ts";

export interface RegionalMetric {
  table: RegionalTable;
  observations: RegionalObservation[];
  /** Most recent year's figure (the headline). */
  latest: RegionalObservation;
  /** The geographic area this metric is for — Bundesland name, or Kreis name. */
  geoLabel: string;
}

export interface RegionalContext {
  /** The building's Bundesland name (the section title). */
  region: string;
  metrics: RegionalMetric[];
}

/**
 * Regional figures for a building, joined at Bundesland AND (when locatable)
 * Kreis grain. `data` is `null` when the building has neither a recognised German
 * region nor a resolvable Kreis, or when every table fetch failed/was empty.
 * Hour-long `staleTime` — regional statistics change at most yearly.
 */
export function useRegionalContext(building: BuildingType) {
  const region = building.region ?? "";
  const landAgs = bundeslandToAgs(region);
  // Shares the cached ["mastrNearby", lat, long] query with the nearby-installations
  // section; we only need its derived Kreis here.
  const { data: nearby } = useNearbyInstallations(building);
  const kreisAgs = nearby?.kreisAgs ?? null;

  return useQuery<RegionalContext | null>({
    queryKey: ["regionalContext", landAgs, kreisAgs, region],
    enabled: Boolean(landAgs || kreisAgs),
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const metrics: RegionalMetric[] = [];

      const collect = async (table: RegionalTable, ags: string, geoLabel: string) => {
        try {
          const observations = await fetchRegionalObservations(table, ags);
          if (observations.length) {
            metrics.push({ table, observations, latest: observations.at(-1)!, geoLabel });
          }
        } catch (err) {
          // Best-effort: one table failing must not sink the section or toast.
          logError(`fetch regional table ${table.tableId}`, err);
        }
      };

      if (landAgs) {
        for (const table of REGIONAL_TABLES.filter((t) => t.grain === "land")) {
          await collect(table, landAgs, region);
        }
      }
      if (kreisAgs) {
        const kreisName = (await fetchKreisName(kreisAgs)) ?? kreisAgs;
        for (const table of REGIONAL_TABLES.filter((t) => t.grain === "kreis")) {
          await collect(table, kreisAgs, kreisName);
        }
      }

      return metrics.length ? { region, metrics } : null;
    },
  });
}
