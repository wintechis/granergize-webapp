/**
 * Per-building rooftop-PV potential query — the building's installable kWp + annual kWh,
 * computed in-app over the roof geometry served by `linked-lod2-by`. A **queried, off-Pod**
 * external observation (no Solid session, no WebID scoping), so a plain `useQuery` — the
 * per-building sibling of {@link useNearbyInstallations} and {@link useStandortEnergieprofil}.
 *
 * Best-effort: the wrapper is an external host that may be down, CORS-blocked, or only seeded
 * for the Bavarian pilot, so the fetch is caught and degraded to `null` (the panel then omits
 * the card) rather than thrown — otherwise the central `QueryCache.onError` toast would fire
 * for a non-critical context layer. The request still shows in the global activity indicator.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { BuildingType } from "../types.ts";
import { fetchRooftopPotential, type RooftopPotential } from "../services/lod2Rooftop.ts";
import { logError } from "../lib/logError.ts";

/**
 * The building's rooftop-PV potential. `data` is `null` when the building has no coordinates
 * (the query stays disabled), the location is outside the dump coverage, or the fetch failed.
 * Hour-long `staleTime` — the LoD2 model changes slowly.
 */
export function useLod2Rooftop(
  building: BuildingType,
): UseQueryResult<RooftopPotential | null> {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<RooftopPotential | null>({
    queryKey: ["lod2Rooftop", lat, long],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      if (lat == null || long == null) return null;
      try {
        return await fetchRooftopPotential(lat, long);
      } catch (err) {
        // Best-effort: a down/partial wrapper must not sink the page or toast.
        logError("fetch rooftop-PV potential", err);
        return null;
      }
    },
  });
}
