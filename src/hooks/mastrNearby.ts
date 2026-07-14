/**
 * Nearby-installations query: the renewable-energy units around a building's
 * coordinates, from `linked-mastr`. A **queried, off-Pod** external observation
 * (no Solid session, no WebID scoping), so a plain `useQuery` — the finest-grain
 * sibling of {@link useRegionalContext}.
 *
 * Best-effort: the wrapper is an external host that may be down, CORS-blocked, or
 * (currently) only seeded for a subset of Germany, so the query is `meta.silent`
 * (no central toast for a non-critical context layer). The failure still THROWS —
 * a caught-to-`null` result would be cached as *success* for the hour-long
 * staleTime, freezing a transient outage; an errored query retries on the next
 * mount instead. The request still shows in the global activity indicator.
 *
 * Besides the installation list this resolves the building's **Kreis** (from the
 * units' municipality AGS), which {@link useRegionalContext} consumes for its
 * Kreis-grain tables — there is no point-in-polygon endpoint to ask instead.
 */
import { useQuery } from "@tanstack/react-query";
import type { Building } from "../types.ts";
import {
  fetchNearbyInstallations,
  kreisFromInstallations,
  type NearbyInstallation,
} from "../services/sources/mastrNearby.ts";
import { sourceKeys } from "../services/sources/sourceKeys.ts";

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
export function useNearbyInstallations(building: Building) {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<NearbyContext | null>({
    queryKey: [...sourceKeys.mastrNearby, lat, long],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    // Best-effort layer: no toast — but the error must surface to React Query
    // (not be cached as a null success) so a wrapper outage stays retryable.
    meta: { silent: true },
    queryFn: async () => {
      if (lat == null || long == null) return null;
      const installations = await fetchNearbyInstallations(lat, long);
      return { installations, kreisAgs: kreisFromInstallations(installations) };
    },
  });
}
