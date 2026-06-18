import L from "leaflet";
import {
  MARKER_OWNED_COLOR,
  MARKER_SHARED_COLOR,
} from "../../constants/chartColors.ts";

/**
 * The plain owned/shared building pin (brand-blue owned / orange shared), matching
 * the main map's ownership lens. A single cached `DivIcon` per ownership so it isn't
 * rebuilt on re-render. Shared by every map that drops a building marker — the
 * detail-page header thumbnail and the observation-page neighbourhood choropleth —
 * so the building reads identically everywhere.
 */
const pinCache = new Map<string, L.DivIcon>();

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
  });
  pinCache.set(key, icon);
  return icon;
}
