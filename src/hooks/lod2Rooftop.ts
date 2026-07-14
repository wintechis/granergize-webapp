/**
 * Per-building rooftop-PV potential query — the building's installable kWp + annual kWh,
 * computed in-app over the roof geometry served by `linked-lod2-by`. A **queried, off-Pod**
 * external observation (no Solid session, no WebID scoping), so a plain `useQuery` — the
 * per-building sibling of {@link useNearbyInstallations} and {@link useStandortEnergieprofil}.
 *
 * Best-effort: the wrapper is an external host that may be down, CORS-blocked, or only seeded
 * for the Bavarian pilot, so every query here is `meta.silent` (no central toast for a
 * non-critical context layer; the panel simply omits the card). Failures still THROW — a
 * caught-to-`null` result would be cached as *success* for the hour-long staleTime, freezing
 * a transient outage; an errored query retries on the next mount instead. The requests still
 * show in the global activity indicator.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Building } from "../types.ts";
import {
  type Building3d,
  fetchBuilding3d,
  fetchNearbyRooftopGeometry,
  fetchNearbyRooftops,
  fetchOpenBuilding,
  fetchRooftopPotential,
  type NearbyRooftop,
  type NearbyRooftopGeometry,
  type RooftopPotential,
} from "../services/sources/lod2Rooftop.ts";
import { sourceKeys } from "../services/sources/sourceKeys.ts";

/**
 * The building's rooftop-PV potential. `data` is `null` when the building has no coordinates
 * (the query stays disabled), the location is outside the dump coverage, or the fetch failed.
 * Hour-long `staleTime` — the LoD2 model changes slowly.
 */
/**
 * Resolve a single open (LoD2) building BY ITS IRI — the in-app open-building detail
 * drilled to from the finder/map (`/building?uri=<lod2-iri>`). Off-Pod, read-only,
 * best-effort: a down/uncovered wrapper degrades to `null` (the page shows "not
 * available") rather than throwing. Hour-long `staleTime`.
 */
export function useOpenBuildingDetail(
  iri: string,
): UseQueryResult<RooftopPotential | null> {
  return useQuery<RooftopPotential | null>({
    queryKey: [...sourceKeys.openBuildingDetail, iri],
    enabled: Boolean(iri),
    staleTime: 1000 * 60 * 60,
    meta: { silent: true },
    queryFn: () => fetchOpenBuilding(iri),
  });
}

export function useLod2Rooftop(
  building: Building,
): UseQueryResult<RooftopPotential | null> {
  const { lat, long, streetAddress } = building;
  const located = lat != null && long != null;
  return useQuery<RooftopPotential | null>({
    queryKey: [...sourceKeys.lod2Rooftop, lat, long, streetAddress],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    meta: { silent: true },
    queryFn: () => {
      if (lat == null || long == null) return null;
      // Pass the building's street address as the LoD2 shared key (prefer an
      // address match over the merely-nearest building).
      return fetchRooftopPotential(lat, long, undefined, streetAddress);
    },
  });
}

/**
 * The building's full measured LoD2 solid (roof/wall/ground surfaces, native UTM 3D) for the
 * {@link ../components/building/Building3DViewer.tsx 3D viewer}. Off-Pod, best-effort: `data`
 * is `null` when the building has no coordinates (query disabled), the location is outside the
 * dump coverage, or the fetch failed. Hour-long `staleTime` — the LoD2 model changes slowly.
 */
export function useBuilding3d(
  building: Building,
): UseQueryResult<Building3d | null> {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<Building3d | null>({
    queryKey: [...sourceKeys.building3d, lat, long],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    meta: { silent: true },
    queryFn: () => {
      if (lat == null || long == null) return null;
      return fetchBuilding3d(lat, long);
    },
  });
}

/**
 * Rooftop-PV potential of buildings NEAR this one — the neighbourhood sibling of
 * {@link useLod2Rooftop} (and the rooftop analogue of {@link useNearbyInstallations}). `data`
 * is `[]` when the building has no coordinates (query disabled), the area is outside the dump
 * coverage, or the fetch failed. Hour-long `staleTime` — the LoD2 model changes slowly.
 */
export function useNearbyRooftops(
  building: Building,
): UseQueryResult<NearbyRooftop[]> {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<NearbyRooftop[]>({
    queryKey: [...sourceKeys.lod2NearbyRooftops, lat, long],
    enabled: located,
    staleTime: 1000 * 60 * 60,
    meta: { silent: true },
    queryFn: () => {
      if (lat == null || long == null) return [];
      return fetchNearbyRooftops(lat, long);
    },
  });
}

/**
 * Nearby rooftops WITH footprint geometry — the deref-heavy upgrade of {@link useNearbyRooftops}
 * (one request per nearby building). Gated by `enabled` so the derefs fire only when the map view
 * is actually open (the list/summary need just the cheap point summary). `[]` on no-coords/failure.
 */
export function useNearbyRooftopGeometry(
  building: Building,
  enabled: boolean,
): UseQueryResult<NearbyRooftopGeometry[]> {
  const { lat, long } = building;
  const located = lat != null && long != null;
  return useQuery<NearbyRooftopGeometry[]>({
    queryKey: [...sourceKeys.lod2NearbyRooftopGeom, lat, long],
    enabled: enabled && located,
    staleTime: 1000 * 60 * 60,
    meta: { silent: true },
    queryFn: () => {
      if (lat == null || long == null) return [];
      return fetchNearbyRooftopGeometry(lat, long);
    },
  });
}
