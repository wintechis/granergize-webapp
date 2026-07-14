/**
 * Global-indicator tracking for a Leaflet tile layer — the ONE way a map's
 * basemap fetches feed the header `NetworkActivityIndicator` (loading-spinner
 * policy: feed the activity store, no component spinners). One activity token
 * per tile-loading burst: the layer fires `loading` when it starts fetching and
 * `load` once the visible set is in, so panning/zooming registers without a
 * token per image. The unmount cleanup closes a still-open burst (e.g. logout
 * mid-pan) — otherwise the indicator counts a phantom in-flight request forever.
 *
 * Usage: `<WMSTileLayer … eventHandlers={useTileActivity()} />`.
 */
import { useEffect, useMemo, useRef } from "react";
import { beginActivity, endActivity } from "../lib/networkActivity.ts";

export function useTileActivity(label = "map tiles") {
  const token = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (token.current !== null) {
        endActivity(token.current);
        token.current = null;
      }
    };
  }, []);
  return useMemo(() => ({
    loading: () => {
      if (token.current === null) {
        token.current = beginActivity(label);
      }
    },
    load: () => {
      if (token.current !== null) {
        endActivity(token.current);
        token.current = null;
      }
    },
  }), [label]);
}
