/**
 * Reports the live map zoom + viewport bbox to the parent on every settle (and once
 * on mount), so a viewport-scoped / zoom-driven choropleth can refetch as the user
 * pans and zooms. Shared by the neighbourhood map (Gemeinde) and the regional-metrics
 * map (Bundesland ⇄ Kreis).
 */
import { useEffect } from "react";
import { useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";

/** "minLon,minLat,maxLon,maxLat" at 2-dp — coarse so small pans reuse the same query. */
function bboxOf(bounds: LatLngBounds): string {
  const r = (n: number) => n.toFixed(2);
  return `${r(bounds.getWest())},${r(bounds.getSouth())},${r(bounds.getEast())},${r(bounds.getNorth())}`;
}

export default function ViewWatch(
  { onChange }: { onChange: (zoom: number, bbox: string) => void },
) {
  const map = useMapEvents({
    zoomend: () => onChange(map.getZoom(), bboxOf(map.getBounds())),
    moveend: () => onChange(map.getZoom(), bboxOf(map.getBounds())),
  });
  useEffect(() => {
    onChange(map.getZoom(), bboxOf(map.getBounds()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
