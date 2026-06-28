/**
 * The building's location energy profile for the Standort-Energieprofil panel. A
 * **queried, off-Pod** external observation (plain `useQuery`, no WebID scoping) —
 * the per-Gemeinde sibling of {@link useNearbyInstallations} (installations) and
 * {@link useRegionalContext} (Bundesland/Kreis tables).
 *
 * Two sources, one panel: the building's Gemeinde AGS is resolved from the nearest
 * MaStR units (reusing {@link useNearbyInstallations}; React Query dedupes the
 * shared `["mastrNearby", lat, long]` fetch), then `area/{ags}` gives the per-Gemeinde
 * Energie-Atlas profile. The same nearby units also feed the panel's "nearby
 * generation" card, so they are returned here too. The Energie-Atlas profile is
 * `null` outside Bavaria; the nearby units are nationwide.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { sourceKeys } from "../services/sources/sourceKeys.ts";
import type { Building } from "../types.ts";
import { useNearbyInstallations } from "./mastrNearby.ts";
import {
  gemeindeFromInstallations,
  type NearbyInstallation,
} from "../services/sources/mastrNearby.ts";
import {
  type AreaProfile,
  fetchAreaProfile,
} from "../services/sources/standortEnergieprofil.ts";

export interface StandortEnergieprofil {
  /** The Energie-Atlas query (`data` is the per-Gemeinde profile, or `null`). */
  query: UseQueryResult<AreaProfile | null>;
  /** The resolved Gemeinde AGS (for the Developer-mode source link), or `null`. */
  ags: string | null;
  /** Renewable installations near the building (nationwide; may be empty). */
  installations: NearbyInstallation[];
}

export function useStandortEnergieprofil(
  building: Building,
): StandortEnergieprofil {
  const nearby = useNearbyInstallations(building);
  const installations = nearby.data?.installations ?? [];
  const ags = nearby.data ? gemeindeFromInstallations(installations) : null;
  const query = useQuery<AreaProfile | null>({
    queryKey: [...sourceKeys.standortEnergieprofil, ags],
    enabled: Boolean(ags),
    staleTime: 1000 * 60 * 60,
    queryFn: () => fetchAreaProfile(ags as string),
  });
  return { query, ags, installations };
}
