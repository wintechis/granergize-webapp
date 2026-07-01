/**
 * The Buildings finder's **open** source tier: public open-data buildings from LoD2
 * (`linked-lod2-by`), fetched by map viewport (a centre + radius), adapted to
 * `Building` (read-only, off-Pod). A **queried, off-Pod** layer — no Solid session,
 * a plain `useQuery` — the finder-wide sibling of {@link useNearbyRooftops}.
 *
 * Coverage is the LoD2 pilot dump (Bavaria); outside it the wrapper returns nothing, so
 * the open tier is simply empty there. Fetched ONLY when the open tier is ticked (the
 * `enabled` gate) so it costs nothing for the common owned/shared browsing. Hour-long
 * `staleTime` (the LoD2 model changes slowly); best-effort — a down/partial wrapper
 * yields `[]`, never a toast.
 */
import { useQuery } from "@tanstack/react-query";
import type { Building } from "../types.ts";
import { fetchNearbyRooftops } from "../services/sources/lod2Rooftop.ts";
import {
  type MapCentre,
  openRooftopToBuilding,
} from "../services/sources/openBuildings.ts";
import { logError } from "../lib/logError.ts";
import { sourceKeys } from "../services/sources/sourceKeys.ts";

export function useOpenBuildings(
  centre: MapCentre | null,
  radiusM: number,
  enabled: boolean,
) {
  // Primitives in the key (not the `centre` object) → a stable, exhaustive queryKey.
  const lat = centre?.lat ?? null;
  const long = centre?.long ?? null;
  return useQuery<Building[]>({
    queryKey: [...sourceKeys.openBuildings, lat, long, radiusM],
    enabled: enabled && lat != null && long != null,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      if (lat == null || long == null) return [];
      try {
        const rooftops = await fetchNearbyRooftops(lat, long, radiusM);
        return rooftops.map(openRooftopToBuilding);
      } catch (err) {
        // Best-effort: a down/partial wrapper must not sink the finder or toast.
        logError("fetch open buildings (LoD2-BY)", err);
        return [];
      }
    },
  });
}
