/**
 * The Observations finder's **open** source tier: nearby renewable installations'
 * actually-settled generation (`linked-netztransparenz`, joined via MaStR), fetched by
 * map viewport. A **queried, off-Pod** layer — no Solid session, a plain `useQuery` —
 * the Observations sibling of {@link useOpenBuildings}.
 *
 * Fetched ONLY when the open tier is ticked (the `enabled` gate), so it costs nothing for
 * the common owned/shared browsing. Hour-long `staleTime` (settlements are annual);
 * best-effort — a down/partial wrapper yields `[]`, never a toast.
 */
import { useQuery } from "@tanstack/react-query";
import type { MapCentre } from "../services/openBuildings.ts";
import {
  fetchNearbyGenerationTotal,
  fetchNearbyOpenObservations,
  OPEN_OBSERVATIONS_LIMIT,
  type OpenObservation,
} from "../services/openObservations.ts";
import { logError } from "../lib/logError.ts";

export function useOpenObservations(
  centre: MapCentre | null,
  radiusM: number,
  enabled: boolean,
) {
  // Primitives in the key (not the `centre` object) → a stable, exhaustive queryKey.
  const lat = centre?.lat ?? null;
  const long = centre?.long ?? null;
  return useQuery<OpenObservation[]>({
    queryKey: ["openObservations", lat, long, radiusM],
    enabled: enabled && lat != null && long != null,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      if (lat == null || long == null) return [];
      try {
        return await fetchNearbyOpenObservations({ lat, long }, radiusM);
      } catch (err) {
        // Best-effort: a down/partial wrapper must not sink the finder or toast.
        logError("fetch open observations (netztransparenz)", err);
        return [];
      }
    },
  });
}

/**
 * The latest settled-year generation total across a building's nearby installations —
 * the StandortEnergieprofil card's "actual generation" line. Keyed on the (capped) iri
 * set so it dedups across renders; best-effort (null on failure / no settled data).
 */
export function useNearbyGeneration(installationIris: readonly string[]) {
  // The capped iri set is the exact identity fetched; React Query keys by VALUE, so the
  // freshly-allocated array each render is a stable key (and the fetch's own dep).
  const sample = installationIris.slice(0, OPEN_OBSERVATIONS_LIMIT);
  return useQuery({
    queryKey: ["nearbyGeneration", sample],
    enabled: sample.length > 0,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      try {
        return await fetchNearbyGenerationTotal(sample);
      } catch (err) {
        logError("fetch nearby generation (netztransparenz)", err);
        return null;
      }
    },
  });
}
