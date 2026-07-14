import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { getStoredViewport, setStoredViewport } from "../../lib/mapViewport.ts";
import { Building } from "../../types.ts";

/**
 * Non-rendering Leaflet helper layers for {@link BuildingsMap} — each is a
 * `useMap`/`useMapEvents` child that wires one viewport concern (size
 * invalidation, initial framing, URL ⇄ viewport sync, bounds/zoom reporting) and
 * renders `null`. Kept out of the map component so its body stays about the cube
 * surface, not Leaflet plumbing.
 */

/**
 * Leaflet miscalculates its size when its container was hidden (display:none).
 * When this map's tab becomes active again, recompute the size once it's visible.
 */
export function InvalidateOnActive({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    // Cleared on unmount — a late call on a destroyed Leaflet map throws.
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [active, map]);
  return null;
}

/**
 * Frame the map on the located buildings — once. Runs the first time the tab is
 * active and at least one building has coordinates; afterwards the user's
 * panning/zooming sticks (we never re-fit). Does nothing when no building has
 * coordinates, leaving the current view untouched.
 */
export function FitToBuildings(
  { active, buildings }: { active: boolean; buildings: Building[] },
) {
  const map = useMap();
  const done = useRef(false);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (done.current || !active) return;
    // A remembered viewport (the in-session store, surviving a detail drill) or one
    // seeded in the URL (?c=&z=, a shared/deep link) wins over the auto-fit — the map
    // shouldn't be reframed to the markers. ViewportUrlSync applies it; we stand down.
    if (getStoredViewport() || (searchParams.get("c") && searchParams.get("z"))) {
      done.current = true;
      return;
    }
    const pts = buildings
      .filter((b) => b.lat != null && b.long != null)
      .map((b) => [b.lat as number, b.long as number] as [number, number]);
    if (pts.length === 0) return;
    done.current = true;
    // Defer so it runs after invalidateSize() has corrected the container size;
    // cleared on unmount (a late call on a destroyed Leaflet map throws).
    const t = setTimeout(
      () => map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] }),
      0,
    );
    return () => clearTimeout(t);
  }, [active, buildings, map, searchParams]);
  return null;
}

/** Write the map's centre+zoom to the URL (`?c=<lat>,<lng>&z=<zoom>`), REPLACE so
 * panning doesn't spam history (a later navigation still captures the latest view). */
function writeViewport(
  map: L.Map,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
) {
  const c = map.getCenter();
  // Preserved component state: remember the viewport so a re-mount (after a detail
  // drill) restores it, independent of the URL. The `?c`/`?z` write below stays for the
  // open-data fetch + deep-link seed.
  setStoredViewport({ lat: c.lat, long: c.lng }, map.getZoom());
  setSearchParams((prev) => {
    const sp = new URLSearchParams(prev);
    sp.set("c", `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`);
    sp.set("z", String(Math.round(map.getZoom() * 100) / 100));
    return sp;
  }, { replace: true });
}

/**
 * Two-way sync of the map viewport with the URL. On mount, a viewport present in
 * the URL (`?c=&z=`) is applied once (so a shared link / Back restores the exact
 * view, ahead of FitToBuildings). On every pan/zoom settle the current view is
 * written back. Makes the map a real, bookmarkable URI.
 */
export function ViewportUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const map = useMapEvents({
    moveend: () => writeViewport(map, setSearchParams),
    zoomend: () => writeViewport(map, setSearchParams),
  });
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true; // apply at most once (and never re-fire on our own write)
    // Preferred: the in-session stored viewport — it survives the finder's unmount on a
    // detail drill, so coming back restores the exact view (no snap-to-fit). Falls back
    // to `?c`/`?z` for a fresh deep link / shared map URL.
    const stored = getStoredViewport();
    if (stored) {
      const t = setTimeout(
        () => map.setView([stored.centre.lat, stored.centre.long], stored.zoom),
        0,
      );
      return () => clearTimeout(t);
    }
    const c = searchParams.get("c");
    const z = searchParams.get("z");
    if (!c || !z) return;
    const [lat, lng] = c.split(",").map(Number);
    const zoom = Number(z);
    if ([lat, lng, zoom].every(Number.isFinite)) {
      const t = setTimeout(() => map.setView([lat, lng], zoom), 0);
      return () => clearTimeout(t);
    }
  }, [map, searchParams]);
  return null;
}

/**
 * Reports the map's current bounding box to the parent whenever the user pans
 * or zooms (and once the map becomes visible, since invalidateSize changes the
 * visible bounds without firing a move event).
 */
export function BoundsWatcher(
  { active, onChange }: {
    active: boolean;
    onChange: (bounds: L.LatLngBounds) => void;
  },
) {
  const map = useMapEvents({
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  });
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => onChange(map.getBounds()), 50);
      return () => clearTimeout(t);
    }
  }, [active, map, onChange]);
  return null;
}

/** Reports the map's current zoom to the parent (the LOD branch: choropleth ⇄ clusters ⇄
 *  pins). Mirrors {@link BoundsWatcher}; a separate watcher keeps the zoom a plain number. */
export function ZoomWatcher(
  { active, onChange }: { active: boolean; onChange: (zoom: number) => void },
) {
  const map = useMapEvents({
    zoomend: () => onChange(map.getZoom()),
    moveend: () => onChange(map.getZoom()),
  });
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => onChange(map.getZoom()), 50);
      return () => clearTimeout(t);
    }
  }, [active, map, onChange]);
  return null;
}
