import { type BuildingType } from "../types.ts";
import { type NearbyRooftop } from "./lod2Rooftop.ts";

/** A map viewport centre — the point the open-building bbox is grown around. */
export interface MapCentre {
  lat: number;
  long: number;
}

/** Fallback fetch half-width (m) when the URL carries no zoom. */
export const OPEN_BUILDINGS_RADIUS_M = 2000;

/** The open-data fetch radius (m) for a Leaflet zoom — wider view → bigger box, closer
 *  view → smaller — so the fetch tracks how much map is shown. Clamped to a sane band
 *  (the wrapper caps dense results anyway). */
export function openRadiusForZoom(zoom: number): number {
  return Math.round(Math.min(20000, Math.max(500, 40_000_000 / 2 ** zoom)));
}

/** What the open layer fetches for the current map URL state (`?c` centre, `?z` zoom):
 *  the centre **snapped to a ~110 m grid** so micro-pans reuse the cached fetch (a
 *  coarse debounce on top of `moveend`), and the zoom-scaled radius. `centre` is null
 *  when no viewport is in the URL yet (the finder then shows a "pan the map" hint).
 *  Shared by the finder + the map so both derive the SAME query key → one fetch. */
export function openViewport(
  params: URLSearchParams,
): { centre: MapCentre | null; radiusM: number } {
  const z = Number(params.get("z"));
  const radiusM = Number.isFinite(z) && z > 0
    ? openRadiusForZoom(z)
    : OPEN_BUILDINGS_RADIUS_M;
  const c = params.get("c");
  if (!c) return { centre: null, radiusM };
  const [lat, long] = c.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) {
    return { centre: null, radiusM };
  }
  const snap = (n: number) => Math.round(n * 1000) / 1000;
  return { centre: { lat: snap(lat), long: snap(long) }, radiusM };
}

/**
 * Adapt a LoD2 `NearbyRooftop` (the `linked-lod2-by` open-data rooftop summary) into
 * the finder's `BuildingType`, flagged `isOpen` so it lands in the **open** source
 * tier — public, off-Pod, read-only. The wrapper gives an IRI + coordinates + the
 * installable rooftop-PV capacity, but **no name/address**, so no `label` is set: the
 * display layer renders an open-specific label (it must NOT parse meaning from the IRI
 * — the no-URI-magic rule). `uri` keeps the source IRI for the dev-mode source link and
 * the "open the source" navigation; `id` is the IRI (a stable React/list key, never
 * routed to the Pod-backed `/building/:id`). Pure → Tier-1 testable.
 */
export function openRooftopToBuilding(r: NearbyRooftop): BuildingType {
  return {
    id: r.iri,
    uri: r.iri,
    type: "",
    isShared: false,
    isOpen: true,
    lat: r.lat,
    long: r.long,
    openKwp: r.installableKwp,
  };
}
