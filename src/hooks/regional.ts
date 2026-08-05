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
import { useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { sourceKeys } from "../services/sources/sourceKeys.ts";
import type { Building } from "../types.ts";
import { bundeslandName, bundeslandToAgs } from "../services/sources/region.ts";
import {
  fetchKreisName,
  fetchRegionalObservations,
  fetchRegionalSeries,
  regionalGeoUrl,
  REGIONAL_TABLES,
  type RegionalObservation,
  type RegionalTable,
} from "../services/sources/regionalCube.ts";
import type {
  RegionalGrain,
  RegionalTableSeries,
} from "../services/cube/regionalCells.ts";
import { useNearbyInstallations } from "./mastrNearby.ts";
import { fetchRegionAgs } from "../services/sources/regionGeometry.ts";
import { logError } from "../lib/logError.ts";

export interface RegionalMetric {
  table: RegionalTable;
  observations: RegionalObservation[];
  /** Most recent year's figure (the headline). */
  latest: RegionalObservation;
  /** The geographic area this metric is for — Bundesland name, or Kreis name. */
  geoLabel: string;
  /** The place's dereferenceable IRI (the cube's geo-dimension value) — the
   * Developer-mode source link, the handoff to the place beyond the app. */
  geoUri: string;
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
export function useRegionalContext(building: Building) {
  // The region's bare AGS: the geocode-time field if present, else resolved by
  // dereferencing the building's `dcterms:spatial` concept (its authoritative
  // `dcterms:identifier`). Land = first 2 digits, Kreis = first 5. Falls back to the
  // vcard Bundesland + the nearby-MaStR Kreis when no region concept is recorded.
  const { data: resolvedAgs } = useQuery({
    queryKey: [...sourceKeys.regionAgs, building.regionConceptIri],
    queryFn: () => fetchRegionAgs(building.regionConceptIri!),
    enabled: !!building.regionConceptIri,
    staleTime: Infinity, // region codes are immutable
  });
  const storedAgs = building.regionAgs ?? resolvedAgs ?? undefined;
  const region = building.region ?? "";
  const landAgs = storedAgs ? storedAgs.slice(0, 2) : bundeslandToAgs(region);
  // Shares the cached ["mastrNearby", lat, long] query with the nearby-installations
  // section; only consulted for the Kreis when there's no stored region.
  const { data: nearby } = useNearbyInstallations(building);
  const kreisAgs = storedAgs ? storedAgs.slice(0, 5) : (nearby?.kreisAgs ?? null);
  // The section title — the building's vcard region name, else derived from the AGS.
  const regionName = region || (landAgs ? bundeslandName(landAgs) ?? "" : "");

  return useQuery<RegionalContext | null>({
    queryKey: [...sourceKeys.regionalContext, landAgs, kreisAgs, regionName],
    enabled: Boolean(landAgs || kreisAgs),
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const metrics: RegionalMetric[] = [];

      const collect = async (table: RegionalTable, ags: string, geoLabel: string) => {
        try {
          const observations = await fetchRegionalObservations(table, ags);
          if (observations.length) {
            metrics.push({
              table,
              observations,
              latest: observations.at(-1)!,
              geoLabel,
              geoUri: regionalGeoUrl(table, ags),
            });
          }
        } catch (err) {
          // Best-effort: one table failing must not sink the section or toast.
          logError(`fetch regional table ${table.tableId}`, err);
        }
      };

      if (landAgs) {
        for (const table of REGIONAL_TABLES.filter((t) => t.grain === "land")) {
          await collect(table, landAgs, regionName);
        }
      }
      if (kreisAgs) {
        const kreisName = (await fetchKreisName(kreisAgs)) ?? kreisAgs;
        for (const table of REGIONAL_TABLES.filter((t) => t.grain === "kreis")) {
          await collect(table, kreisAgs, kreisName);
        }
      }

      return metrics.length ? { region: regionName, metrics } : null;
    },
  });
}

/**
 * Fill each building's **`regionAgs`** from its stored region concept — the bare AGS
 * is not in the building file: it is the `dcterms:spatial` concept's own
 * `dcterms:identifier`, read by dereferencing it ({@link fetchRegionAgs}, memoised per
 * IRI on the immutable `["regionAgs", iri]` entry). So EVERY surface that joins
 * buildings to regions (the map's choropleth, the pivot's feature-ladder roll-up and
 * its `?in=` scope) must resolve it first, or every loaded building falls into the
 * "no region" bucket. One shared hook so they resolve it the same way and share the
 * cache entries.
 *
 * A freshly geocoded building already carries its own `regionAgs` and is passed
 * through untouched. `enabled` gates the fan-out on the region join actually being
 * needed (the choropleth being shown, the pivot sitting at a region level) — the
 * explicit act, not a background fetch. The returned array is referentially stable
 * while the inputs and the resolved codes are.
 */
export function useBuildingsWithRegionAgs(
  buildings: Building[],
  enabled = true,
): Building[] {
  const conceptIris = useMemo(
    () => [
      ...new Set(
        buildings.map((b) => b.regionConceptIri).filter((x): x is string => !!x),
      ),
    ],
    [buildings],
  );
  const agsQueries = useQueries({
    queries: conceptIris.map((iri) => ({
      queryKey: [...sourceKeys.regionAgs, iri],
      queryFn: () => fetchRegionAgs(iri),
      enabled,
      staleTime: Infinity, // region codes are immutable
    })),
  });
  // Destructure the (referentially-unstable) query results to plain data + a stable
  // signature, then a concept→AGS lookup.
  const agsData = agsQueries.map((q) => q.data);
  const agsSig = agsData.join("|");
  const agsByConcept = new Map<string, string>();
  conceptIris.forEach((iri, i) => {
    const a = agsData[i];
    if (a) agsByConcept.set(iri, a);
  });
  return useMemo(
    () =>
      buildings.map((b) =>
        b.regionAgs || !b.regionConceptIri
          ? b
          : { ...b, regionAgs: agsByConcept.get(b.regionConceptIri) }
      ),
    // agsByConcept is rebuilt each render, but its content is captured by agsSig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, agsSig],
  );
}

/** Keep the tables that loaded — a failed one is simply absent (see below).
 *  Module-level (stable identity) so `useQueries` memoises it. */
function loadedTables(
  results: Array<UseQueryResult<RegionalTableSeries | null>>,
): RegionalTableSeries[] {
  return results.map((r) => r.data).filter((d): d is RegionalTableSeries => d != null);
}

/**
 * The regional-statistics tables for the pivot's **drill-across** section
 * (`services/cube/regionalCells.ts`): one query per table of the given grain, each
 * fetching the WHOLE table in one GET (all regions × all years — the wrapper serves
 * it that way, so the fan-out is one tracked request per table, not per region).
 *
 * `grain === null` (every row level the source has no counterpart for) yields no
 * queries at all, so the fetch is gated on the pivot actually sitting at a matching
 * level — the explicit act that crosses the materialization boundary.
 *
 * Long `staleTime`: official statistics are published yearly, so within a session
 * they are static. Best-effort per table, like {@link useRegionalContext}: a failing
 * table resolves to `null` (logged, never thrown), so it drops out of the section
 * instead of raising the central error toast for a context layer.
 */
export function useRegionalPivotTables(
  grain: RegionalGrain | null,
): RegionalTableSeries[] {
  const tables = grain ? REGIONAL_TABLES.filter((t) => t.grain === grain) : [];
  return useQueries({
    queries: tables.map((table) => ({
      queryKey: [...sourceKeys.regionalSeries, table.tableId],
      queryFn: async (): Promise<RegionalTableSeries | null> => {
        try {
          return {
            tableId: table.tableId,
            labelId: table.labelId,
            grain: table.grain,
            byRegion: await fetchRegionalSeries(table),
          };
        } catch (err) {
          logError(`fetch regional table ${table.tableId}`, err);
          return null;
        }
      },
      staleTime: 1000 * 60 * 60 * 24,
    })),
    combine: loadedTables,
  });
}
