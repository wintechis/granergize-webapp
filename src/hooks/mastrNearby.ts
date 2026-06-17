/**
 * Nearby-installations query: the renewable-energy units around a building's
 * coordinates, from `linked-mastr`. A **queried, off-Pod** external observation
 * (no Solid session, no WebID scoping), so a plain `useQuery` — the finest-grain
 * sibling of {@link useRegionalContext}.
 *
 * Best-effort: the wrapper is an external host that may be down, CORS-blocked, or
 * (currently) only seeded for a subset of Germany, so the fetch is caught and
 * degraded to `null` rather than thrown — otherwise the central
 * `QueryCache.onError` toast would fire for a non-critical context layer. The
 * request still shows in the global activity indicator (via `trackedFetch`).
 *
 * Besides the installation list this resolves the building's **Kreis** (from the
 * units' municipality AGS), which {@link useRegionalContext} consumes for its
 * Kreis-grain tables — there is no point-in-polygon endpoint to ask instead.
 */
import { useQuery } from "@tanstack/react-query";
import type { BuildingType } from "../types.ts";
import {
  fetchNearbyInstallations,
  kreisFromInstallations,
  type NearbyInstallation,
} from "../services/rdf/mastrNearby.ts";
import { logError } from "../lib/logError.ts";

export interface NearbyContext {
  installations: NearbyInstallation[];
  /** The building's 5-digit Kreis AGS, or null when no nearby unit located it. */
  kreisAgs: string | null;
}

/**
 * Renewable installations near a building, plus its derived Kreis. `data` is
 * `null` when the building has no coordinates (the query stays disabled) or the
 * fetch failed. Hour-long `staleTime` — the register changes slowly.
 */
export function useNearbyInstallations(building: BuildingType) {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<NearbyContext | null>({
    queryKey: ["mastrNearby", lat, long],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      if (lat == null || long == null) return null;
      try {
        const installations = await fetchNearbyInstallations(lat, long);
        return { installations, kreisAgs: kreisFromInstallations(installations) };
      } catch (err) {
        // Best-effort: a down/partial wrapper must not sink the page or toast.
        logError("fetch nearby installations", err);
        return null;
      }
    },
  });
}
