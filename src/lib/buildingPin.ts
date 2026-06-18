import L from "leaflet";
import { MARKER_OWNED_COLOR, MARKER_SHARED_COLOR } from "../constants/chartColors.ts";

const pinCache = new Map<string, L.DivIcon>();

/**
 * The owned/shared map pin (brand-blue owned / orange shared) as a cached Leaflet
 * `DivIcon` — ONE source for both the Explore map's markers and the detail-page
 * {@link LocatorMap}, so the brand pin can't drift between them (it used to be
 * copied in `ExplorePage` and `BuildingHeader`). The `pin-owned`/`pin-shared`
 * className is a stable e2e hook. Cached per ownership so a re-render reuses the
 * same icon instance.
 */
export function buildingPin(shared: boolean): L.DivIcon {
  const key = shared ? "s" : "o";
  const hit = pinCache.get(key);
  if (hit) return hit;
  const color = shared ? MARKER_SHARED_COLOR : MARKER_OWNED_COLOR;
  const icon = L.divIcon({
    className: `pin-marker pin-${shared ? "shared" : "owned"}`,
    html:
      `<svg width="25" height="41" viewBox="0 0 25 41" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));" aria-hidden="true">` +
      `<path d="M12.5 0.5C5.9 0.5 0.5 5.9 0.5 12.5c0 9 12 27.5 12 27.5s12-18.5 12-27.5C24.5 5.9 19.1 0.5 12.5 0.5z" fill="${color}" stroke="#fff" stroke-width="1"/>` +
      `<circle cx="12.5" cy="12.5" r="4.5" fill="#fff"/></svg>`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
  pinCache.set(key, icon);
  return icon;
}
